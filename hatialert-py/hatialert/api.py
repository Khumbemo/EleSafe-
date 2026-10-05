"""HTTP-agnostic JSON API.

`App.handle()` takes a method, path, query, body and headers and returns
(status, content_type, body). The stdlib server and the in-browser Pyodide
bridge both call it, so the same code answers every request.
"""

from __future__ import annotations

import base64
import binascii
import csv
import io
import json
import re
import statistics
from collections import Counter
from urllib.parse import parse_qs

import hashlib
import hmac
import secrets

from . import domain
from .security import new_token, verify_pin
from .store import DEMO_ACCOUNTS, Store, now_ms


class ApiError(Exception):
    def __init__(self, status: int, message: str, field: str | None = None):
        super().__init__(message)
        self.status, self.message, self.field = status, message, field


ROUTES: list[tuple[str, re.Pattern, str, str | None]] = []


def route(method: str, pattern: str, auth: str | None = "user"):
    """auth: None (public), 'user', 'staff' or 'officer'."""

    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn.__name__, auth))
        return fn

    return deco


# -- input helpers -------------------------------------------------------
def _plain(x):
    return str(int(x)) if float(x).is_integer() else str(x)


def _num(body, key, cast, lo, hi, default=0):
    raw = body.get(key, default)
    if raw in ("", None):
        raw = default
    try:
        val = cast(raw)
    except (TypeError, ValueError):
        raise ApiError(400, "Enter a number.", key)
    if val != val or not lo <= val <= hi:  # NaN or out of range
        raise ApiError(400, f"Enter a value from {_plain(lo)} to {_plain(hi)}.", key)
    return val


def _text(body, key, max_len, required=False):
    val = str(body.get(key) or "").strip()
    if required and not val:
        raise ApiError(400, "This field is required.", key)
    if len(val) > max_len:
        raise ApiError(400, f"Keep this under {max_len} characters.", key)
    return val


def _pin(body, key="pin"):
    pin = str(body.get(key) or "")
    if not re.fullmatch(r"\d{4,6}", pin):
        raise ApiError(400, "Choose a PIN of 4 to 6 digits.", key)
    if len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        raise ApiError(400, "That PIN is too easy to guess. Avoid repeated or running digits.", key)
    return pin


def _cell(value):
    """Stop spreadsheet apps from running a cell as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def _media(item, field="attachments"):
    """Validate one {kind, data} upload (data is base64, data: URL prefix allowed)."""
    if not isinstance(item, dict) or item.get("kind") not in domain.MEDIA:
        raise ApiError(400, "Attach a photo or a voice note.", field)
    kind, rule = item["kind"], domain.MEDIA[item["kind"]]
    raw = str(item.get("data") or "")
    if raw.startswith("data:"):
        raw = raw.partition(",")[2]
    raw = re.sub(r"\s", "", raw)
    try:
        blob = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "That file didn't upload properly. Try again.", field)
    if not blob:
        raise ApiError(400, "That file is empty.", field)
    if len(blob) > rule["max_bytes"]:
        limit = rule["max_bytes"] / 1_000_000
        raise ApiError(413, f"Each {'photo' if kind == 'photo' else 'voice note'} must be under {limit:g} MB.", field)
    mime = domain.sniff_media(blob[:16])
    if mime not in rule["mimes"]:
        raise ApiError(415, "Use a JPEG, PNG or WebP photo." if kind == "photo"
                       else "Use a recording in MP3, M4A, WebM, Ogg or WAV.", field)
    return kind, mime, blob


def _media_list(items, existing=None):
    if items is None:
        return []
    if not isinstance(items, list):
        raise ApiError(400, "Attach a photo or a voice note.", "attachments")
    out = [_media(i) for i in items]
    counts = dict(existing or {})
    for kind, _, _ in out:
        counts[kind] = counts.get(kind, 0) + 1
        if counts[kind] > domain.MEDIA[kind]["max_count"]:
            n = domain.MEDIA[kind]["max_count"]
            raise ApiError(400, f"A report can have up to {n} {'photos' if kind == 'photo' else 'voice notes'}.", "attachments")
    return out


def normalize_phone(raw) -> str:
    digits = re.sub(r"\D", "", str(raw or ""))
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if not re.fullmatch(r"[6-9]\d{9}", digits):
        raise ApiError(400, "Enter a 10-digit mobile number.", "phone")
    return digits


class NoSms:
    enabled, mode, host = False, "manual", ""


# Account safety limits
SESSION_IDLE_MS = 30 * domain.DAY_MS        # sign out after 30 days unused
SESSION_MAX_MS = 180 * domain.DAY_MS        # and after 180 days in any case
LOGIN_WINDOW_MS = 15 * 60_000
LOGIN_MAX_PAIR = 5        # wrong PINs per number from one device/network in 15 min
LOGIN_MAX_IP = 30         # wrong PINs from one network in 15 min, any number
LOGIN_MAX_PHONE_DAY = 20  # wrong PINs per number in 24 h, from anywhere
OTP_TTL_MS = 10 * 60_000
OTP_MAX_TRIES = 5
OTP_PER_PHONE_HOUR = 3
OTP_PER_IP_HOUR = 10
REPORTS_PER_HOUR = {"villager": 20, "guard": 100, "officer": 100}
ALERTS_PER_HOUR = 30
UPLOAD_BYTES_PER_DAY = 60_000_000
MUST_CHANGE_ALLOWED = {"get_meta", "get_me", "post_logout", "post_pin", "post_logout_all"}


class App:
    def __init__(self, store: Store, clock=now_ms, demo: bool = True, sms=None, system=None, wake=None):
        self.store, self.clock, self.demo = store, clock, demo
        self.wake = wake or (lambda: None)  # tells the SMS sender there is new mail
        self.sms = sms or NoSms()
        self.system = system or (lambda: {})  # server adds backup info
        self.secret = secrets.token_bytes(32)  # keys one-time-code hashes

    # -- dispatch --------------------------------------------------------
    def handle(self, method: str, path: str, query: str = "", body=b"", headers=None):
        headers = {k.lower(): v for k, v in (headers or {}).items()}
        q = {k: v[-1] for k, v in parse_qs(query or "").items()}
        try:
            for m, pattern, name, auth in ROUTES:
                match = pattern.match(path)
                if not match or m != method:
                    continue
                self.ip = headers.get("x-hatialert-client") or "local"
                user = self._auth(headers, auth)
                if user and user["must_change_pin"] and auth is not None and name not in MUST_CHANGE_ALLOWED:
                    raise ApiError(403, "Choose a new PIN first.", "pin")
                data = self._body(body) if method in ("POST", "PATCH", "PUT") else {}
                result = getattr(self, name)(user, data, q, *match.groups())
                if isinstance(result, tuple):  # (content_type, text)
                    return 200, result[0], result[1]
                return 200, "application/json", json.dumps(result)
            if any(p.match(path) for _, p, _, _ in ROUTES):
                raise ApiError(405, "Method not allowed.")
            raise ApiError(404, "Not found.")
        except ApiError as e:
            return e.status, "application/json", json.dumps({"error": e.message, "field": e.field})

    def handle_json(self, method, path, query, body, auth_header):
        """Bridge for the Pyodide preview: strings in, one JSON string out."""
        status, ctype, text = self.handle(method, path, query, body or "", {"authorization": auth_header or ""})
        return json.dumps({"status": status, "type": ctype, "body": text})

    def _body(self, body):
        if isinstance(body, bytes):
            body = body.decode("utf-8", "replace")
        if not body:
            return {}
        try:
            data = json.loads(body)
        except ValueError:
            raise ApiError(400, "Request body must be JSON.")
        if not isinstance(data, dict):
            raise ApiError(400, "Request body must be a JSON object.")
        return data

    def _auth(self, headers, level):
        token = headers.get("authorization", "").removeprefix("Bearer ").strip()
        user = self.store.user_by_token(token) if token else None
        if user:
            now = self.clock()
            if now - user["_session_seen"] > SESSION_IDLE_MS or now - user["_session_created"] > SESSION_MAX_MS or not user["active"]:
                self.store.drop_session(token)
                if level is not None:
                    raise ApiError(401, "Your sign-in has expired. Sign in again." if user["active"]
                                   else "This account is switched off. Contact the forest office.")
                user = None
            else:
                if now - user["_session_seen"] > 10 * 60_000:
                    self.store.touch_session(token, now)
                user["_token"] = token
        if level is None:
            return user
        if not user:
            raise ApiError(401, "Sign in to continue.")
        if level == "staff" and user["role"] not in domain.STAFF:
            raise ApiError(403, "Only forest staff can do this.")
        if level == "officer" and user["role"] != "officer":
            raise ApiError(403, "Only forest officers can do this.")
        return user

    # -- views -----------------------------------------------------------
    @staticmethod
    def user_view(u):
        out = {k: u[k] for k in ("id", "name", "phone", "village", "role", "radius_km")}
        out.update(phone_verified=bool(u["phone_verified"]), must_change_pin=bool(u["must_change_pin"]),
                   sms_alerts=bool(u["sms_alerts"]))
        return out

    # -- villages ---------------------------------------------------------
    def _village(self, body, key="village"):
        name = body.get(key)
        v = self.store.village(name) if isinstance(name, str) else None
        if not v or not v["active"]:
            raise ApiError(400, "Choose a village from the list.", key)
        return v["name"]

    def _home(self, user):
        return self.store.village(user["village"]) or self.store.villages()[0]

    @staticmethod
    def village_view(v):
        return {k: v[k] for k in ("id", "name", "lat", "lng", "verified", "source")}

    def incident_view(self, row, viewer, events=None):
        staff = viewer and viewer["role"] in domain.STAFF
        mine = bool(viewer and row["reporter_id"] == viewer["id"])
        out = {
            k: row[k]
            for k in (
                "id", "type", "severity", "status", "herd_size", "casualties", "crop_acres",
                "property_inr", "heading", "village", "lat", "lng", "place", "description",
                "created_at", "updated_at",
            )
        }
        out.update(
            ref=domain.reference(row["id"], row["created_at"]),
            type_label=domain.INCIDENT_TYPES[row["type"]]["label"],
            severity_label=domain.SEVERITY_LABELS[row["severity"]],
            status_label=domain.STATUS_LABELS[row["status"]],
            open=row["status"] in domain.OPEN_STATUSES,
            sample=bool(row["sample"]),
            mine=mine,
        )
        atts = self.store.attachments(row["id"])
        # Photos can show injured people or homes: only the reporter and staff see them.
        out["attachments"] = [
            {"id": a["id"], "kind": a["kind"], "mime": a["mime"], "size": a["size"], "created_at": a["created_at"]}
            for a in atts
        ] if staff or mine else []
        out["attachments_hidden"] = 0 if staff or mine else len(atts)
        if staff or mine:
            reporter = self.store.user(row["reporter_id"]) if row["reporter_id"] else None
            out["reporter"] = ({"name": reporter["name"], "phone": reporter["phone"], "phone_verified": bool(reporter["phone_verified"])}
                               if reporter else None)
        if events is not None:
            out["events"] = [
                {
                    "status": e["status"], "status_label": domain.STATUS_LABELS[e["status"]],
                    "note": e["note"], "at": e["at"],
                    "by": e["user_name"] if staff or e["user_role"] in domain.STAFF else None,
                    "by_role": e["user_role"],
                }
                for e in events
            ]
            out["can_attach"] = bool(staff or mine)
            out["next"] = [
                s for s in domain.TRANSITIONS[row["status"]]
                if viewer and viewer["role"] in domain.TRANSITION_ROLES[s]
            ]
        return out

    # -- public ----------------------------------------------------------
    @route("GET", "/api/meta", auth=None)
    def get_meta(self, user, data, q):
        out = domain.meta()
        out["villages"] = [self.village_view(v) for v in self.store.villages()]
        out["sms_enabled"] = self.sms.enabled
        out["demo_accounts"] = (
            [{k: a[k] for k in ("name", "phone", "pin", "role", "village")} for a in DEMO_ACCOUNTS]
            if self.demo else []
        )
        return out

    @route("POST", "/api/severity", auth=None)
    def post_severity(self, user, data, q):
        kind = data.get("type")
        if kind not in domain.INCIDENT_TYPES:
            raise ApiError(400, "Choose what happened.", "type")
        herd = _num(data, "herd_size", int, *domain.LIMITS["herd_size"], default=1)
        cas = _num(data, "casualties", int, *domain.LIMITS["casualties"])
        sev = domain.classify_severity(kind, herd, cas)
        return {"severity": sev, "label": domain.SEVERITY_LABELS[sev]}

    # -- auth ------------------------------------------------------------
    def _start_session(self, user):
        token = new_token()
        self.store.add_session(token, user["id"], self.clock())
        return {"token": token, "user": self.user_view(user)}

    def _login_block(self, phone, now):
        """Raise 429 when this number or network has had too many wrong PINs."""
        ip = self.ip
        pair = self.store.failed_logins(now - LOGIN_WINDOW_MS, phone=phone, ip=ip)
        net = self.store.failed_logins(now - LOGIN_WINDOW_MS, ip=ip)
        day = self.store.failed_logins(now - domain.DAY_MS, phone=phone)
        if len(day) >= LOGIN_MAX_PHONE_DAY:
            raise ApiError(429, "Too many wrong PINs for this number today. Ask a forest officer to unlock it.", "pin")
        for hits, cap in ((pair, LOGIN_MAX_PAIR), (net, LOGIN_MAX_IP)):
            if len(hits) >= cap:
                wait = -(-(LOGIN_WINDOW_MS - (now - hits[-cap])) // 60_000)  # whole minutes, rounded up
                raise ApiError(429, f"Too many wrong PINs. Try again in {wait} min.", "pin")

    @route("POST", "/api/auth/login", auth=None)
    def post_login(self, user, data, q):
        phone = normalize_phone(data.get("phone"))
        now = self.clock()
        self._login_block(phone, now)
        found = self.store.user_by_phone(phone)
        if not found or not verify_pin(str(data.get("pin") or ""), found["pin_hash"]):
            self.store.add_failed_login(phone, self.ip, now)
            if found is None or now % 50 == 0:
                self.store.prune_failed_logins(now - 2 * domain.DAY_MS)
            raise ApiError(401, "That phone number and PIN don't match.", "pin")
        if not found["active"]:
            raise ApiError(403, "This account is switched off. Contact the forest office.", "phone")
        self.store.clear_failed_logins(phone)
        self.store.prune_sessions(now - SESSION_IDLE_MS, now - SESSION_MAX_MS)
        return self._start_session(found)

    # one-time codes (only when an SMS service is set up)
    def _otp_hash(self, phone, purpose, code):
        return hmac.new(self.secret, f"{phone}|{purpose}|{code}".encode(), hashlib.sha256).hexdigest()

    @route("POST", "/api/auth/otp", auth=None)
    def post_otp(self, user, data, q):
        if not self.sms.enabled:
            raise ApiError(409, "Text messages aren't set up on this server. Ask a forest officer.")
        phone = normalize_phone(data.get("phone"))
        purpose = data.get("purpose")
        if purpose not in ("register", "reset"):
            raise ApiError(400, "Unknown code type.")
        now = self.clock()
        if (self.store.otp_messages_since(now - domain.HOUR_MS, phone=phone) >= OTP_PER_PHONE_HOUR
                or self.store.otp_messages_since(now - domain.HOUR_MS, ip=self.ip) >= OTP_PER_IP_HOUR):
            raise ApiError(429, "Too many codes requested. Try again in an hour.", "phone")
        exists = self.store.user_by_phone(phone)
        if purpose == "register" and exists:
            raise ApiError(409, "This number is already registered. Sign in instead.", "phone")
        if purpose == "register" or exists:  # a reset for an unknown number sends nothing
            code = f"{secrets.randbelow(10**6):06d}"
            self.store.set_otp(phone, purpose, self._otp_hash(phone, purpose, code), now + OTP_TTL_MS)
            self.store.queue_messages([("otp", phone, f"HatiAlert code: {code}. It expires in 10 minutes. Do not share it.",
                                        "queued", None, exists["id"] if exists else None, self.ip, now)])
            self.wake()
        return {"sent": True, "message": "If this number can get texts, a 6-digit code is on its way."}

    def _check_otp(self, phone, purpose, code):
        row = self.store.otp(phone, purpose)
        now = self.clock()
        if not row or row["expires_at"] < now:
            raise ApiError(400, "That code has expired. Ask for a new one.", "code")
        if row["attempts"] >= OTP_MAX_TRIES:
            raise ApiError(429, "Too many wrong codes. Ask for a new one.", "code")
        if not hmac.compare_digest(row["code_hash"], self._otp_hash(phone, purpose, str(code or "").strip())):
            self.store.bump_otp(phone, purpose)
            raise ApiError(400, "That code isn't right.", "code")
        self.store.drop_otp(phone, purpose)

    @route("POST", "/api/auth/register", auth=None)
    def post_register(self, user, data, q):
        name = _text(data, "name", domain.LIMITS["name"], required=True)
        if len(name) < 2:
            raise ApiError(400, "Enter your full name.", "name")
        phone = normalize_phone(data.get("phone"))
        village = self._village(data)
        pin = _pin(data)
        if self.store.user_by_phone(phone):
            raise ApiError(409, "This number is already registered. Sign in instead.", "phone")
        verified = False
        if self.sms.enabled:
            self._check_otp(phone, "register", data.get("code"))
            verified = True
        return self._start_session(self.store.create_user(name, phone, village, pin, at=self.clock(), phone_verified=verified))

    @route("POST", "/api/auth/reset", auth=None)
    def post_reset(self, user, data, q):
        if not self.sms.enabled:
            raise ApiError(409, "Text messages aren't set up on this server. Ask a forest officer to reset your PIN.")
        phone = normalize_phone(data.get("phone"))
        found = self.store.user_by_phone(phone)
        if not found:
            raise ApiError(400, "That code has expired. Ask for a new one.", "code")
        self._check_otp(phone, "reset", data.get("code"))
        pin = _pin(data)
        self.store.set_pin(found["id"], pin)
        self.store.drop_sessions(found["id"])
        self.store.clear_failed_logins(phone)
        self.store.update_user(found["id"], {"phone_verified": 1})
        self.store.audit(found["id"], "pin_reset_sms", phone, self.clock())
        return self._start_session(self.store.user(found["id"]))

    @route("POST", "/api/auth/logout")
    def post_logout(self, user, data, q):
        self.store.drop_session(user["_token"])
        return {"ok": True}

    @route("POST", "/api/me/logout-all")
    def post_logout_all(self, user, data, q):
        self.store.drop_sessions(user["id"], keep_token=user["_token"])
        return {"ok": True}

    @route("POST", "/api/me/pin")
    def post_pin(self, user, data, q):
        if not verify_pin(str(data.get("old_pin") or ""), user["pin_hash"]):
            now = self.clock()
            self._login_block(user["phone"], now)
            self.store.add_failed_login(user["phone"], self.ip, now)
            raise ApiError(400, "Your current PIN isn't right.", "old_pin")
        pin = _pin(data, "pin")
        if verify_pin(pin, user["pin_hash"]):
            raise ApiError(400, "Choose a PIN different from the old one.", "pin")
        self.store.set_pin(user["id"], pin)
        self.store.drop_sessions(user["id"], keep_token=user["_token"])
        return self.user_view(self.store.user(user["id"]))

    @route("GET", "/api/me")
    def get_me(self, user, data, q):
        return self.user_view(user)

    @route("PATCH", "/api/me")
    def patch_me(self, user, data, q):
        fields = {}
        if "name" in data:
            fields["name"] = _text(data, "name", domain.LIMITS["name"], required=True)
        if "village" in data:
            fields["village"] = self._village(data)
        if "radius_km" in data:
            fields["radius_km"] = _num(data, "radius_km", float, *domain.LIMITS["radius_km"])
        if "sms_alerts" in data:
            fields["sms_alerts"] = 1 if data["sms_alerts"] else 0
        return self.user_view(self.store.update_user(user["id"], fields))

    # -- incidents -------------------------------------------------------
    @route("GET", "/api/incidents")
    def get_incidents(self, user, data, q):
        status = q.get("status", "open")
        where, args = [], []
        if q.get("mine") == "1":
            where.append("reporter_id = ?")
            args.append(user["id"])
        elif status != "open" and user["role"] not in domain.STAFF:
            raise ApiError(403, "Only forest staff can see closed cases.")
        if status == "open":
            where.append("status IN ('reported','verified','responded')")
        elif status == "closed":
            where.append("status IN ('resolved','false_report')")
        elif status != "all":
            raise ApiError(400, "status must be open, closed or all.")
        if q.get("village"):
            where.append("village = ?")
            args.append(q["village"])
        rows = self.store.incidents(" AND ".join(where) or "1=1", args)
        return [self.incident_view(r, user) for r in rows]

    def _incident(self, iid):
        row = self.store.incident(int(iid))
        if not row:
            raise ApiError(404, "No incident with that number.")
        return row

    @route("GET", r"/api/incidents/(\d+)")
    def get_incident(self, user, data, q, iid):
        row = self._incident(iid)
        return self.incident_view(row, user, self.store.events(row["id"]))

    @route("POST", "/api/incidents")
    def post_incident(self, user, data, q):
        client_id = data.get("client_id")
        if client_id is not None:
            if not isinstance(client_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", client_id):
                raise ApiError(400, "Bad report id.", "client_id")
            dup = self.store.incident_by_client_id(user["id"], client_id)
            if dup:  # the same report sent again after a dropped connection
                return self.get_incident(user, {}, {}, dup["id"])
        now = self.clock()
        if self.store.count_since("incidents", "reporter_id", user["id"], now - domain.HOUR_MS) >= REPORTS_PER_HOUR[user["role"]]:
            raise ApiError(429, "You've sent a lot of reports in the last hour. Wait a little, or phone the forest office if it's urgent.")
        kind = data.get("type")
        if kind not in domain.INCIDENT_TYPES:
            raise ApiError(400, "Choose what happened.", "type")
        village = self._village(data)
        herd = _num(data, "herd_size", int, *domain.LIMITS["herd_size"], default=1)
        cas = _num(data, "casualties", int, *domain.LIMITS["casualties"])
        if kind in ("injury", "death") and cas == 0:
            cas = 1
        heading = data.get("heading") or ""
        if heading and heading not in domain.DIRECTIONS:
            raise ApiError(400, "Choose a direction from the list.", "heading")
        if "lat" in data and "lng" in data and data["lat"] not in ("", None):
            lat = _num(data, "lat", float, 25.0, 27.5)
            lng = _num(data, "lng", float, 93.0, 95.5)
        else:
            offset = _num(data, "offset_km", float, *domain.LIMITS["offset_km"])
            direction = data.get("offset_dir") or ""
            if offset and direction not in domain.DIRECTIONS:
                raise ApiError(400, "Say which way from the village.", "offset_dir")
            v = self.store.village(village)
            lat, lng = domain.destination(v["lat"], v["lng"], offset, direction)
        record = {
            "type": kind,
            "severity": domain.classify_severity(kind, herd, cas),
            "herd_size": herd,
            "casualties": cas,
            "crop_acres": round(_num(data, "crop_acres", float, *domain.LIMITS["crop_acres"]), 2),
            "property_inr": _num(data, "property_inr", int, *domain.LIMITS["property_inr"]),
            "heading": heading,
            "village": village,
            "lat": lat,
            "lng": lng,
            "place": _text(data, "place", 120),
            "description": _text(data, "description", domain.LIMITS["description"]),
            "client_id": client_id,
        }
        media = _media_list(data.get("attachments"))
        self._upload_quota(user, sum(len(b) for _, _, b in media), now)
        iid = self.store.add_incident(record, user["id"], now, media=media)
        return self.get_incident(user, {}, {}, iid)

    @route("POST", r"/api/incidents/(\d+)/attachments")
    def post_attachment(self, user, data, q, iid):
        row = self._incident(iid)
        if user["role"] not in domain.STAFF and row["reporter_id"] != user["id"]:
            raise ApiError(403, "Only the reporter or forest staff can add to this case.")
        have = {}
        for a in self.store.attachments(row["id"]):
            have[a["kind"]] = have.get(a["kind"], 0) + 1
        kind, mime, blob = _media_list([data], have)[0]
        now = self.clock()
        self._upload_quota(user, len(blob), now)
        self.store.add_attachment(row["id"], kind, mime, blob, user["id"], now)
        self.store.add_event(row["id"], row["status"], "Added a photo" if kind == "photo" else "Added a voice note", user["id"], now)
        return self.get_incident(user, {}, {}, iid)

    def _upload_quota(self, user, adding, now):
        if adding and self.store.upload_bytes_since(user["id"], now - domain.DAY_MS) + adding > UPLOAD_BYTES_PER_DAY:
            raise ApiError(413, "You've uploaded a lot of photos and recordings today. Try again tomorrow.", "attachments")

    @route("GET", r"/api/attachments/(\d+)")
    def get_attachment(self, user, data, q, aid):
        a = self.store.attachment(int(aid))
        if not a:
            raise ApiError(404, "That file is no longer available.")
        owner = self.store.incident(a["incident_id"])
        if user["role"] not in domain.STAFF and owner["reporter_id"] != user["id"] and a["user_id"] != user["id"]:
            raise ApiError(403, "Only the reporter and forest staff can see these files.")
        return {"id": a["id"], "kind": a["kind"], "mime": a["mime"], "size": a["size"],
                "data": base64.b64encode(a["data"]).decode()}

    @route("PATCH", r"/api/incidents/(\d+)", auth="staff")
    def patch_incident(self, user, data, q, iid):
        row = self._incident(iid)
        status = data.get("status") or None
        note = _text(data, "note", domain.LIMITS["description"])
        if not status and not note:
            raise ApiError(400, "Choose a new status or write a note.", "note")
        if status:
            if status not in domain.TRANSITIONS[row["status"]]:
                raise ApiError(409, f"A {domain.STATUS_LABELS[row['status']].lower()} case can't move to that status.", "status")
            if user["role"] not in domain.TRANSITION_ROLES[status]:
                raise ApiError(403, "Only a forest officer can close a case.", "status")
        self.store.add_event(row["id"], status or row["status"], note, user["id"], self.clock(), new_status=status)
        return self.get_incident(user, {}, {}, iid)

    @route("GET", r"/api/incidents/(\d+)/villages", auth="staff")
    def get_incident_villages(self, user, data, q, iid):
        row = self._incident(iid)
        km = _num(q, "km", float, 0.5, 30, default=5)
        out = []
        for v in self.store.villages():
            d = domain.haversine_km(v["lat"], v["lng"], row["lat"], row["lng"])
            if d <= km:
                b = domain.bearing_deg(v["lat"], v["lng"], row["lat"], row["lng"])
                out.append({"name": v["name"], "km": round(d, 1), "dir": domain.compass(b)})
        return sorted(out, key=lambda x: x["km"])

    # -- alerts ----------------------------------------------------------
    def _active_warnings(self, now):
        latest = {}
        for a in reversed(self.store.alerts(200)):  # oldest first
            if a["level"] in ("warning", "all_clear"):
                for v in a["villages"]:
                    latest[v] = a
        return {v: a for v, a in latest.items() if a["level"] == "warning" and now - a["sent_at"] < domain.DAY_MS}

    def alert_view(self, a, user, active_ids=()):
        return {
            "id": a["id"], "level": a["level"], "level_label": domain.ALERT_LEVELS[a["level"]],
            "message": a["message"], "villages": a["villages"], "incident_id": a["incident_id"],
            "by": a["user_name"], "sent_at": a["sent_at"], "sample": bool(a["sample"]),
            "affects_me": user["village"] in a["villages"], "active": a["id"] in active_ids,
        }

    @route("GET", "/api/alerts")
    def get_alerts(self, user, data, q):
        active = {a["id"] for a in self._active_warnings(self.clock()).values()}
        return [self.alert_view(a, user, active) for a in self.store.alerts()]

    @route("POST", "/api/alerts", auth="staff")
    def post_alert(self, user, data, q):
        level = data.get("level")
        if level not in domain.ALERT_LEVELS:
            raise ApiError(400, "Choose an alert type.", "level")
        message = _text(data, "message", domain.LIMITS["message"], required=True)
        villages = data.get("villages") or []
        known = [v["name"] for v in self.store.villages()]
        if not isinstance(villages, list) or not villages or any(v not in known for v in villages):
            raise ApiError(400, "Pick at least one village.", "villages")
        incident_id = data.get("incident_id")
        if incident_id is not None:
            incident_id = self._incident(incident_id)["id"]
        now = self.clock()
        if self.store.count_since("alerts", "user_id", user["id"], now - domain.HOUR_MS) >= ALERTS_PER_HOUR:
            raise ApiError(429, "That's a lot of alerts in one hour. Wait a little before sending more.")
        ordered = [n for n in known if n in villages]
        aid = self.store.add_alert(level, message, ordered, incident_id, user["id"], now)
        # One text per person in those villages who wants alert SMS.
        people = self.store.alert_recipients(ordered)
        text = f"HatiAlert {domain.ALERT_LEVELS[level]} ({', '.join(ordered)}): {message}"
        status = "queued" if self.sms.enabled else "manual"
        self.store.queue_messages([("alert", p["phone"], text, status, aid, p["id"], "", now) for p in people])
        if status == "queued":
            self.wake()
        a = next(x for x in self.store.alerts() if x["id"] == aid)
        active = {x["id"] for x in self._active_warnings(now).values()}
        return {**self.alert_view(a, user, active), "sms": {"recipients": len(people), "mode": self.sms.mode if self.sms.enabled else "manual"}}

    # -- home ------------------------------------------------------------
    @route("GET", "/api/overview")
    def get_overview(self, user, data, q):
        now = self.clock()
        home = self.village_view(self._home(user))
        nearby = []
        open_rows = self.store.incidents("status IN ('reported','verified','responded')")
        for r in open_rows:
            d = domain.haversine_km(home["lat"], home["lng"], r["lat"], r["lng"])
            if d <= user["radius_km"]:
                b = domain.bearing_deg(home["lat"], home["lng"], r["lat"], r["lng"])
                nearby.append({**self.incident_view(r, user), "km": round(d, 1), "dir": domain.compass(b)})
        nearby.sort(key=lambda x: (x["km"], -x["created_at"]))
        warning = self._active_warnings(now).get(user["village"])
        return {
            "village": home,
            "radius_km": user["radius_km"],
            "nearby": nearby,
            "warning": self.alert_view(warning, user, {warning["id"]}) if warning else None,
            "open_total": len(open_rows),
            "reported_24h": sum(1 for r in open_rows if now - r["created_at"] < domain.DAY_MS),
            "awaiting_check": sum(1 for r in open_rows if r["status"] == "reported"),
            "has_sample": bool(self.store.one("SELECT 1 AS x FROM incidents WHERE sample = 1 LIMIT 1")),
        }

    # -- officer ---------------------------------------------------------
    def _window(self, q):
        days = int(_num(q, "days", int, 1, 365, default=30))
        since = self.clock() - days * domain.DAY_MS
        return days, since, self.store.incidents("created_at >= ?", (since,), limit=100_000)

    @route("GET", "/api/stats", auth="officer")
    def get_stats(self, user, data, q):
        days, since, rows = self._window(q)
        responded = self.store.first_event_times("responded")
        hours = [(responded[r["id"]] - r["created_at"]) / domain.HOUR_MS for r in rows if r["id"] in responded]
        by_village = Counter(r["village"] for r in rows)
        series = Counter(domain.ist_date(r["created_at"]) for r in rows)
        end = self.clock()
        dates = [domain.ist_date(end - i * domain.DAY_MS) for i in range(days - 1, -1, -1)]
        return {
            "days": days,
            "total": len(rows),
            "open": sum(r["status"] in domain.OPEN_STATUSES for r in rows),
            "resolved": sum(r["status"] == "resolved" for r in rows),
            "false_reports": sum(r["status"] == "false_report" for r in rows),
            "median_response_h": round(statistics.median(hours), 1) if hours else None,
            "responded_count": len(hours),
            "by_type": [{"key": k, "label": v["label"], "count": sum(r["type"] == k for r in rows)} for k, v in domain.INCIDENT_TYPES.items()],
            "by_severity": [{"key": k, "label": domain.SEVERITY_LABELS[k], "count": sum(r["severity"] == k for r in rows)} for k in domain.SEVERITIES],
            "by_village": [{"name": n, "count": c} for n, c in sorted(by_village.items(), key=lambda x: (-x[1], x[0]))],
            "series": [{"date": d, "count": series.get(d, 0)} for d in dates],
            "crop_acres": round(sum(r["crop_acres"] for r in rows), 2),
            "property_inr": sum(r["property_inr"] for r in rows),
            "casualties": sum(r["casualties"] for r in rows),
        }

    @route("GET", "/api/export.csv", auth="officer")
    def get_export(self, user, data, q):
        days, since, rows = self._window(q)
        responded = self.store.first_event_times("responded")
        media = self.store.media_counts()
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["report_no", "reported_ist", "type", "severity", "status", "village", "lat", "lng",
                    "herd_size", "casualties", "crop_acres", "property_inr", "heading", "place", "response_hours",
                    "photos", "voice_notes"])
        for r in reversed(rows):
            rh = round((responded[r["id"]] - r["created_at"]) / domain.HOUR_MS, 1) if r["id"] in responded else ""
            w.writerow([domain.reference(r["id"], r["created_at"]), domain.ist_stamp(r["created_at"]), r["type"],
                        r["severity"], r["status"], r["village"], r["lat"], r["lng"], r["herd_size"],
                        r["casualties"], r["crop_acres"], r["property_inr"], r["heading"], _cell(r["place"]), rh,
                        media.get(r["id"], {}).get("photo", 0), media.get(r["id"], {}).get("voice", 0)])
        return "text/csv; charset=utf-8", buf.getvalue()

    @route("DELETE", "/api/sample", auth="officer")
    def delete_sample(self, user, data, q):
        self.store.clear_sample()
        return {"ok": True}

    # -- admin: people -----------------------------------------------------
    def admin_user_view(self, u, now):
        fails = self.store.failed_logins(now - domain.DAY_MS, phone=u["phone"])
        return {**self.user_view(u), "active": bool(u["active"]), "created_at": u["created_at"],
                "last_seen": u.get("last_seen"), "failed_24h": len(fails), "sample": bool(u["sample"])}

    def _target(self, uid):
        u = self.store.user(int(uid))
        if not u:
            raise ApiError(404, "No such person.")
        return u

    @route("GET", "/api/users", auth="officer")
    def get_users(self, user, data, q):
        role = q.get("role", "")
        if role and role not in domain.ROLES:
            raise ApiError(400, "Unknown role.")
        now = self.clock()
        return [self.admin_user_view(u, now) for u in self.store.search_users(q.get("q", "").strip()[:40], role)]

    @route("PATCH", r"/api/users/(\d+)", auth="officer")
    def patch_user(self, user, data, q, uid):
        target = self._target(uid)
        fields, now = {}, self.clock()
        if "role" in data:
            if data["role"] not in domain.ROLES:
                raise ApiError(400, "Unknown role.", "role")
            fields["role"] = data["role"]
        if "active" in data:
            fields["active"] = 1 if data["active"] else 0
        if "village" in data:
            fields["village"] = self._village(data)
        if target["id"] == user["id"] and (fields.get("role", "officer") != "officer" or fields.get("active", 1) == 0):
            raise ApiError(400, "You can't remove your own officer access. Ask another officer.", "role")
        if target["role"] == "officer" and target["active"] and (fields.get("role", "officer") != "officer" or fields.get("active", 1) == 0):
            if self.store.count_officers() <= 1:
                raise ApiError(400, "Keep at least one active forest officer.", "role")
        self.store.update_user(target["id"], fields)
        if fields.get("active") == 0 or "role" in fields:
            self.store.drop_sessions(target["id"])
        self.store.audit(user["id"], "user_update", f"{target['name']} ({target['phone']}): " + ", ".join(f"{k}={v}" for k, v in fields.items()), now)
        return self.admin_user_view(self.store.search_users(target["phone"])[0], now)

    @route("POST", r"/api/users/(\d+)/reset-pin", auth="officer")
    def post_user_reset(self, user, data, q, uid):
        target = self._target(uid)
        while True:
            temp = f"{secrets.randbelow(10**6):06d}"
            if len(set(temp)) > 2:
                break
        self.store.set_pin(target["id"], temp, must_change=True)
        self.store.drop_sessions(target["id"])
        self.store.clear_failed_logins(target["phone"])
        self.store.audit(user["id"], "pin_reset", f"{target['name']} ({target['phone']})", self.clock())
        return {"temp_pin": temp, "user": self.admin_user_view(self.store.search_users(target["phone"])[0], self.clock())}

    @route("POST", r"/api/users/(\d+)/unlock", auth="officer")
    def post_user_unlock(self, user, data, q, uid):
        target = self._target(uid)
        self.store.clear_failed_logins(target["phone"])
        self.store.audit(user["id"], "unlock", f"{target['name']} ({target['phone']})", self.clock())
        return self.admin_user_view(self.store.search_users(target["phone"])[0], self.clock())

    # -- admin: villages -----------------------------------------------------
    BOUNDS = {"lat": (25.5, 27.0), "lng": (93.5, 95.0)}  # Nagaland and its edge

    def _coords(self, data, required=True):
        out = {}
        for k in ("lat", "lng"):
            if k in data or required:
                out[k] = round(_num(data, k, float, *self.BOUNDS[k], default=None if required else 0), 6)
        return out

    @route("GET", "/api/villages", auth="officer")
    def get_villages(self, user, data, q):
        use = self.store.village_usage()
        return [{**self.village_view(v), "active": v["active"], "people": use.get(v["name"], {}).get("people", 0),
                 "incidents": use.get(v["name"], {}).get("incidents", 0)} for v in self.store.villages(include_inactive=True)]

    @route("POST", "/api/villages", auth="officer")
    def post_village(self, user, data, q):
        name = _text(data, "name", 60, required=True)
        if len(name) < 2:
            raise ApiError(400, "Enter the village name.", "name")
        if self.store.village(name):
            raise ApiError(409, "That village is already on the list.", "name")
        c = self._coords(data)
        verified = bool(data.get("verified"))
        source = _text(data, "source", 120, required=verified)
        vid = self.store.add_village(name, c["lat"], c["lng"], verified, source, self.clock())
        self.store.audit(user["id"], "village_add", f"{name} {c['lat']},{c['lng']} {source}", self.clock())
        return self.village_view(self.store.village_by_id(vid))

    @route("PATCH", r"/api/villages/(\d+)", auth="officer")
    def patch_village(self, user, data, q, vid):
        v = self.store.village_by_id(int(vid))
        if not v:
            raise ApiError(404, "No such village.")
        fields = self._coords(data, required=False)
        if "verified" in data:
            fields["verified"] = bool(data["verified"])
        if "source" in data:
            fields["source"] = _text(data, "source", 120)
        if fields.get("verified", v["verified"]) and not fields.get("source", v["source"]):
            raise ApiError(400, "Say where the position comes from before marking it checked.", "source")
        if "active" in data:
            fields["active"] = bool(data["active"])
            if not fields["active"] and len(self.store.villages()) <= 1:
                raise ApiError(400, "Keep at least one village.", "active")
        self.store.update_village(v["id"], fields, self.clock())
        self.store.audit(user["id"], "village_update", f"{v['name']}: " + ", ".join(f"{k}={x}" for k, x in fields.items()), self.clock())
        return {**self.village_view(self.store.village_by_id(v["id"])), "active": self.store.village_by_id(v["id"])["active"]}

    @route("POST", "/api/villages/import", auth="officer")
    def post_village_import(self, user, data, q):
        text = str(data.get("csv") or "")
        if len(text) > 500_000:
            raise ApiError(413, "That list is too long. Split it into smaller files.", "csv")
        rows = list(csv.reader(io.StringIO(text.strip())))
        if not rows:
            raise ApiError(400, "Paste a list with a header row: name,lat,lng,source", "csv")
        head = [h.strip().lower() for h in rows[0]]
        if not {"name", "lat", "lng"} <= set(head):
            raise ApiError(400, "The first row must name the columns: name,lat,lng and optionally source.", "csv")
        ix = {k: head.index(k) for k in ("name", "lat", "lng")}
        isrc = head.index("source") if "source" in head else None
        added = updated = 0
        errors = []
        now = self.clock()
        for n, row in enumerate(rows[1:2001], start=2):
            try:
                name = row[ix["name"]].strip()
                if len(name) < 2 or len(name) > 60:
                    raise ValueError("name")
                c = self._coords({"lat": row[ix["lat"]].strip(), "lng": row[ix["lng"]].strip()})
                source = (row[isrc].strip() if isrc is not None and isrc < len(row) else "") or "Imported list"
            except (IndexError, ValueError, ApiError):
                errors.append(n)
                continue
            have = self.store.village(name)
            if have:
                self.store.update_village(have["id"], {**c, "verified": True, "source": source[:120], "active": True}, now)
                updated += 1
            else:
                self.store.add_village(name, c["lat"], c["lng"], True, source[:120], now)
                added += 1
        self.store.audit(user["id"], "village_import", f"added {added}, updated {updated}, skipped {len(errors)}", now)
        return {"added": added, "updated": updated, "skipped_lines": errors[:50], "skipped": len(errors)}

    # -- admin: messages and system ------------------------------------------
    @route("GET", "/api/outbox", auth="officer")
    def get_outbox(self, user, data, q):
        batches: dict[int, dict] = {}
        alerts = {a["id"]: a for a in self.store.alerts(30)}
        for m in self.store.alert_messages():
            a = alerts.get(m["alert_id"])
            if not a:
                continue
            b = batches.setdefault(m["alert_id"], {"alert_id": a["id"], "level": a["level"], "level_label": domain.ALERT_LEVELS[a["level"]],
                                                   "villages": a["villages"], "sent_at": a["sent_at"], "text": m["body"],
                                                   "counts": {}, "recipients": []})
            b["counts"][m["status"]] = b["counts"].get(m["status"], 0) + 1
            b["recipients"].append({"id": m["id"], "name": m["user_name"], "village": m["user_village"],
                                    "phone": m["phone"], "status": m["status"], "error": m["error"]})
        return {"mode": self.sms.mode if self.sms.enabled else "manual", "batches": sorted(batches.values(), key=lambda b: -b["sent_at"])}

    @route("POST", "/api/outbox/mark", auth="officer")
    def post_outbox_mark(self, user, data, q):
        ids = data.get("ids") or []
        status = data.get("status")
        if status not in ("sent", "queued") or not isinstance(ids, list) or not all(isinstance(i, int) for i in ids) or not ids:
            raise ApiError(400, "Choose messages to update.")
        if status == "queued" and not self.sms.enabled:
            raise ApiError(409, "Text messages aren't set up on this server. Ask a forest officer.")
        n = self.store.set_message_status(ids[:2000], status, self.clock())
        if status == "queued":
            self.wake()
        return {"updated": n}

    @route("GET", "/api/admin/status", auth="officer")
    def get_admin_status(self, user, data, q):
        return {"sms": {"enabled": self.sms.enabled, "mode": self.sms.mode if self.sms.enabled else "manual", "host": self.sms.host},
                "storage": self.store.sizes(), "outbox": self.store.outbox_counts(), "system": self.system(),
                "audit": [{"action": a["action"], "detail": a["detail"], "by": a["user_name"], "at": a["at"]} for a in self.store.audit_log()]}
