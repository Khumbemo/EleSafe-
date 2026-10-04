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


def _village(body, key="village"):
    name = body.get(key)
    if name not in domain.VILLAGE_BY_NAME:
        raise ApiError(400, "Choose a village from the list.", key)
    return name


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


class App:
    MAX_FAILURES = 5
    LOCKOUT_MS = 5 * 60_000

    def __init__(self, store: Store, clock=now_ms, demo: bool = True):
        self.store, self.clock, self.demo = store, clock, demo
        self.failures: dict[str, list[int]] = {}

    # -- dispatch --------------------------------------------------------
    def handle(self, method: str, path: str, query: str = "", body=b"", headers=None):
        headers = {k.lower(): v for k, v in (headers or {}).items()}
        q = {k: v[-1] for k, v in parse_qs(query or "").items()}
        try:
            for m, pattern, name, auth in ROUTES:
                match = pattern.match(path)
                if not match or m != method:
                    continue
                user = self._auth(headers, auth)
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
        return {k: u[k] for k in ("id", "name", "phone", "village", "role", "radius_km")}

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
        out["attachments"] = [
            {"id": a["id"], "kind": a["kind"], "mime": a["mime"], "size": a["size"], "created_at": a["created_at"]}
            for a in self.store.attachments(row["id"])
        ]
        if staff or mine:
            reporter = self.store.user(row["reporter_id"]) if row["reporter_id"] else None
            out["reporter"] = {"name": reporter["name"], "phone": reporter["phone"]} if reporter else None
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
        self.store.add_session(token, user["id"])
        return {"token": token, "user": self.user_view(user)}

    @route("POST", "/api/auth/login", auth=None)
    def post_login(self, user, data, q):
        phone = normalize_phone(data.get("phone"))
        now = self.clock()
        recent = [t for t in self.failures.get(phone, []) if now - t < self.LOCKOUT_MS]
        if len(recent) >= self.MAX_FAILURES:
            wait = int((self.LOCKOUT_MS - (now - recent[0])) / 60_000) + 1
            raise ApiError(429, f"Too many wrong PINs. Try again in {wait} min.", "pin")
        found = self.store.user_by_phone(phone)
        if not found or not verify_pin(str(data.get("pin") or ""), found["pin_hash"]):
            self.failures[phone] = recent + [now]
            raise ApiError(401, "That phone number and PIN don't match.", "pin")
        self.failures.pop(phone, None)
        return self._start_session(found)

    @route("POST", "/api/auth/register", auth=None)
    def post_register(self, user, data, q):
        name = _text(data, "name", domain.LIMITS["name"], required=True)
        if len(name) < 2:
            raise ApiError(400, "Enter your full name.", "name")
        phone = normalize_phone(data.get("phone"))
        village = _village(data)
        pin = str(data.get("pin") or "")
        if not re.fullmatch(r"\d{4,6}", pin):
            raise ApiError(400, "Choose a PIN of 4 to 6 digits.", "pin")
        if self.store.user_by_phone(phone):
            raise ApiError(409, "This number is already registered. Sign in instead.", "phone")
        return self._start_session(self.store.create_user(name, phone, village, pin, at=self.clock()))

    @route("POST", "/api/auth/logout")
    def post_logout(self, user, data, q):
        self.store.drop_session(user["_token"])
        return {"ok": True}

    @route("GET", "/api/me")
    def get_me(self, user, data, q):
        return self.user_view(user)

    @route("PATCH", "/api/me")
    def patch_me(self, user, data, q):
        fields = {}
        if "name" in data:
            fields["name"] = _text(data, "name", domain.LIMITS["name"], required=True)
        if "village" in data:
            fields["village"] = _village(data)
        if "radius_km" in data:
            fields["radius_km"] = _num(data, "radius_km", float, *domain.LIMITS["radius_km"])
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
        kind = data.get("type")
        if kind not in domain.INCIDENT_TYPES:
            raise ApiError(400, "Choose what happened.", "type")
        village = _village(data)
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
            v = domain.VILLAGE_BY_NAME[village]
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
        }
        media = _media_list(data.get("attachments"))
        iid = self.store.add_incident(record, user["id"], self.clock(), media=media)
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
        self.store.add_attachment(row["id"], kind, mime, blob, user["id"], now)
        self.store.add_event(row["id"], row["status"], "Added a photo" if kind == "photo" else "Added a voice note", user["id"], now)
        return self.get_incident(user, {}, {}, iid)

    @route("GET", r"/api/attachments/(\d+)")
    def get_attachment(self, user, data, q, aid):
        a = self.store.attachment(int(aid))
        if not a:
            raise ApiError(404, "That file is no longer available.")
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
        for v in domain.VILLAGES:
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
        if not isinstance(villages, list) or not villages or any(v not in domain.VILLAGE_BY_NAME for v in villages):
            raise ApiError(400, "Pick at least one village.", "villages")
        incident_id = data.get("incident_id")
        if incident_id is not None:
            incident_id = self._incident(incident_id)["id"]
        ordered = [v["name"] for v in domain.VILLAGES if v["name"] in villages]
        aid = self.store.add_alert(level, message, ordered, incident_id, user["id"], self.clock())
        a = next(x for x in self.store.alerts() if x["id"] == aid)
        active = {x["id"] for x in self._active_warnings(self.clock()).values()}
        return self.alert_view(a, user, active)

    # -- home ------------------------------------------------------------
    @route("GET", "/api/overview")
    def get_overview(self, user, data, q):
        now = self.clock()
        home = domain.VILLAGE_BY_NAME[user["village"]]
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
