import base64
import csv
import io
import json
import math
import unittest

from pathlib import Path

from hatialert import domain, geo, security
from hatialert.api import App
from hatialert.store import Store

T0 = 1_790_000_000_000  # fixed clock for repeatable tests


class Clock:
    def __init__(self):
        self.t = T0

    def __call__(self):
        return self.t


def make_app(seed=True):
    clock = Clock()
    store = Store(pin_iterations=1000)
    if seed:
        store.seed(at=T0)
    return App(store, clock=clock), clock


class Client:
    def __init__(self, app, ip="10.0.0.1"):
        self.app, self.token, self.ip = app, None, ip

    def call(self, method, path, body=None):
        path, _, query = path.partition("?")
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        headers["X-HatiAlert-Client"] = self.ip
        status, ctype, text = self.app.handle(method, path, query, json.dumps(body) if body is not None else b"", headers)
        return status, (text if ctype.startswith("text/csv") else json.loads(text))

    def login(self, phone, pin):
        status, data = self.call("POST", "/api/auth/login", {"phone": phone, "pin": pin})
        assert status == 200, data
        self.token = data["token"]
        return data["user"]


def as_role(app, role):
    c = Client(app)
    c.login({"villager": "9000000001", "guard": "9000000002", "officer": "9000000003"}[role],
            {"villager": "1111", "guard": "2222", "officer": "3333"}[role])
    return c


class SeverityTests(unittest.TestCase):
    def test_rules_match_original_app(self):
        cases = [
            (("sighting", 1, 0), "low"), (("sighting", 5, 0), "medium"),
            (("herd_movement", 9, 0), "low"), (("herd_movement", 10, 0), "high"),
            (("crop_raid", 4, 0), "medium"), (("crop_raid", 5, 0), "high"),
            (("property_damage", 1, 0), "high"), (("injury", 1, 0), "critical"),
            (("death", 1, 0), "critical"), (("sighting", 1, 2), "critical"),
        ]
        for args, want in cases:
            self.assertEqual(domain.classify_severity(*args), want, args)


class GeoTests(unittest.TestCase):
    def test_haversine_one_degree_latitude(self):
        self.assertAlmostEqual(domain.haversine_km(26, 94, 27, 94), 111.19, delta=0.05)

    def test_destination_round_trip(self):
        for d in domain.DIRECTIONS:
            lat, lng = domain.destination(26.1, 94.26, 3.0, d)
            self.assertAlmostEqual(domain.haversine_km(26.1, 94.26, lat, lng), 3.0, delta=0.01)
            self.assertEqual(domain.compass(domain.bearing_deg(26.1, 94.26, lat, lng)), d)

    def test_compass_boundaries(self):
        self.assertEqual(domain.compass(22.4), "N")
        self.assertEqual(domain.compass(22.6), "NE")
        self.assertEqual(domain.compass(359), "N")

    def test_reference_uses_ist(self):
        # 2026-09-30 19:00 UTC is already October in IST
        ms = 1_790_794_800_000
        self.assertEqual(domain.reference(7, ms), "HA-2610-0007")


class UtmTests(unittest.TestCase):
    # Reference values from PROJ (pyproj, EPSG:4326 -> EPSG:32646)
    REF = [((26.09717, 94.25817), (625817.193, 2887052.620)),
           ((25.9208, 93.9549), (595630.908, 2867261.356)),
           ((26.5595, 94.3908), (638530.297, 2938399.207))]

    def test_forward_matches_proj(self):
        for (lat, lon), (e, n) in self.REF:
            got = geo.utm(lat, lon)
            self.assertAlmostEqual(got[0], e, delta=0.01)
            self.assertAlmostEqual(got[1], n, delta=0.01)

    def test_inverse_round_trip(self):
        for (lat, lon), _ in self.REF:
            la, lo = geo.utm_inverse(*geo.utm(lat, lon))
            self.assertAlmostEqual(la, lat, places=8)
            self.assertAlmostEqual(lo, lon, places=8)


def _unpack(p):
    out, x, y = [], 0, 0
    for i in range(0, len(p), 2):
        x += p[i]; y += p[i + 1]
        out.append((x * 10.0, y * 10.0))
    return out


def _inside(x, y, ring):
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


class MapDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1] / "hatialert" / "web" / "map"
        cls.layers = json.loads((root / "layers.json").read_text())
        cls.terrain = root / "terrain.webp"

    def test_files_and_extent(self):
        self.assertTrue(self.terrain.exists())
        self.assertEqual(self.layers["crs"].split()[0], "EPSG:32646")
        e0, n0, e1, n1 = self.layers["extent"]
        for v in domain.VILLAGES:
            e, n = (c / 1000 for c in geo.utm(v["lat"], v["lng"]))
            self.assertTrue(e0 < e < e1 and n0 < n < n1, v["name"])
        for c in self.layers["contours"][:3] + self.layers["contours"][-3:]:
            for p in c["paths"][:20]:
                for x, y in _unpack(p):
                    self.assertTrue(e0 * 1000 - 1 <= x <= e1 * 1000 + 1 and n0 * 1000 - 1 <= y <= n1 * 1000 + 1)

    def test_villages_and_peak_inside_wokha(self):
        wokha = next(d for d in self.layers["districts"] if d["name"] == "Wokha")
        rings = [_unpack(r) for r in wokha["rings"]]
        self.assertGreater(sum(len(r) for r in rings), 100)
        for v in domain.VILLAGES:
            x, y = geo.utm(v["lat"], v["lng"])
            self.assertTrue(any(_inside(x, y, r) for r in rings), v["name"])
        peak = self.layers["peaks"][0]
        self.assertTrue(any(_inside(peak["e"] * 1000, peak["n"] * 1000, r) for r in rings))
        self.assertTrue(1900 < peak["elev"] < 2100)  # Mount Tiyi, about 1,969 m

    def test_only_checked_villages_marked_verified(self):
        verified = [v["name"] for v in domain.VILLAGES if v["verified"]]
        self.assertEqual(verified, ["Wokha Town"])


class SecurityTests(unittest.TestCase):
    def test_fallback_pbkdf2_matches_hashlib(self):
        import hashlib
        real = hashlib.pbkdf2_hmac("sha256", b"1234", b"salt", 50)
        saved = hashlib.pbkdf2_hmac
        try:
            del hashlib.pbkdf2_hmac
            self.assertEqual(security._pbkdf2(b"1234", b"salt", 50), real)
        finally:
            hashlib.pbkdf2_hmac = saved

    def test_hash_and_verify(self):
        h = security.hash_pin("4321", 1000)
        self.assertTrue(security.verify_pin("4321", h))
        self.assertFalse(security.verify_pin("4322", h))
        self.assertFalse(security.verify_pin("4321", "garbage"))


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()

    def test_register_login_logout(self):
        c = Client(self.app)
        s, d = c.call("POST", "/api/auth/register", {"name": "Akum", "phone": "+91 98765 43210", "village": "Sanis", "pin": "2468"})
        self.assertEqual(s, 200)
        self.assertEqual(d["user"]["phone"], "9876543210")
        self.assertEqual(d["user"]["role"], "villager")
        s, d = c.call("POST", "/api/auth/register", {"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": "2468"})
        self.assertEqual((s, d["field"]), (409, "phone"))
        c.login("9876543210", "2468")
        self.assertEqual(c.call("GET", "/api/me")[0], 200)
        self.assertEqual(c.call("POST", "/api/auth/logout")[0], 200)
        self.assertEqual(c.call("GET", "/api/me")[0], 401)

    def test_register_validation(self):
        c = Client(self.app)
        for body, field in [
            ({"name": "A", "phone": "9876543210", "village": "Sanis", "pin": "4817"}, "name"),
            ({"name": "Akum", "phone": "12345", "village": "Sanis", "pin": "4817"}, "phone"),
            ({"name": "Akum", "phone": "9876543210", "village": "Paris", "pin": "4817"}, "village"),
            ({"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": "12"}, "pin"),
        ]:
            s, d = c.call("POST", "/api/auth/register", body)
            self.assertEqual((s, d["field"]), (400, field), body)

    def test_lockout_after_five_wrong_pins(self):
        c = Client(self.app)
        for _ in range(5):
            self.assertEqual(c.call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "0000"})[0], 401)
        self.assertEqual(c.call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})[0], 429)
        self.clock.t += 15 * 60_000 + 1
        self.assertEqual(c.call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})[0], 200)

    def test_protected_routes_need_token(self):
        c = Client(self.app)
        for path in ["/api/me", "/api/incidents", "/api/alerts", "/api/overview"]:
            self.assertEqual(c.call("GET", path)[0], 401, path)
        self.assertEqual(c.call("GET", "/api/meta")[0], 200)
        self.assertEqual(c.call("GET", "/api/nope")[0], 404)


class IncidentTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.vil, self.guard, self.off = (as_role(self.app, r) for r in ("villager", "guard", "officer"))

    def report(self, **extra):
        body = {"type": "crop_raid", "herd_size": 6, "village": "Wozhuro", "offset_km": 1, "offset_dir": "NE", **extra}
        return self.vil.call("POST", "/api/incidents", body)

    def test_report_sets_severity_and_location(self):
        s, inc = self.report(crop_acres=1.25, place="=HYPERLINK(1)")
        self.assertEqual(s, 200)
        self.assertEqual(inc["severity"], "high")
        self.assertEqual(inc["status"], "reported")
        self.assertTrue(inc["ref"].startswith("HA-"))
        v = domain.VILLAGE_BY_NAME["Wozhuro"]
        self.assertAlmostEqual(domain.haversine_km(v["lat"], v["lng"], inc["lat"], inc["lng"]), 1.0, delta=0.01)
        self.assertEqual(inc["events"][0]["status"], "reported")

    def test_report_validation(self):
        self.assertEqual(self.report(type="party")[1]["field"], "type")
        self.assertEqual(self.report(herd_size=-1)[1]["field"], "herd_size")
        self.assertEqual(self.report(herd_size="many")[1]["field"], "herd_size")
        self.assertEqual(self.report(offset_dir="")[1]["field"], "offset_dir")
        self.assertEqual(self.report(heading="UP")[1]["field"], "heading")
        self.assertEqual(self.report(lat=10, lng=94)[1]["field"], "lat")

    def test_injury_always_counts_a_casualty(self):
        s, inc = self.report(type="injury", casualties=0)
        self.assertEqual((inc["casualties"], inc["severity"]), (1, "critical"))

    def test_status_workflow_and_permissions(self):
        iid = self.report()[1]["id"]
        self.assertEqual(self.vil.call("PATCH", f"/api/incidents/{iid}", {"status": "verified"})[0], 403)
        self.assertEqual(self.guard.call("PATCH", f"/api/incidents/{iid}", {"status": "resolved"})[0], 409)
        s, inc = self.guard.call("PATCH", f"/api/incidents/{iid}", {"status": "verified", "note": "Tracks seen"})
        self.assertEqual((s, inc["status"]), (200, "verified"))
        self.assertEqual(inc["next"], ["responded", "false_report"])
        self.guard.call("PATCH", f"/api/incidents/{iid}", {"status": "responded"})
        self.assertEqual(self.guard.call("PATCH", f"/api/incidents/{iid}", {"status": "resolved"})[0], 403)
        s, inc = self.off.call("PATCH", f"/api/incidents/{iid}", {"status": "resolved"})
        self.assertEqual(inc["status"], "resolved")
        self.assertEqual([e["status"] for e in inc["events"]], ["reported", "verified", "responded", "resolved"])
        self.assertEqual(self.guard.call("PATCH", f"/api/incidents/{iid}", {})[0], 400)

    def test_privacy_of_reporter_phone(self):
        iid = self.report()[1]["id"]
        other = Client(self.app)
        other.call("POST", "/api/auth/register", {"name": "Other", "phone": "9123456789", "village": "Sanis", "pin": "4817"})
        other.login("9123456789", "4817")
        self.assertNotIn("reporter", other.call("GET", f"/api/incidents/{iid}")[1])
        self.assertEqual(self.guard.call("GET", f"/api/incidents/{iid}")[1]["reporter"]["phone"], "9000000001")

    def test_villager_lists(self):
        self.report()
        mine = self.vil.call("GET", "/api/incidents?mine=1&status=all")[1]
        self.assertTrue(all(i["mine"] for i in mine))
        self.assertEqual(self.vil.call("GET", "/api/incidents?status=closed")[0], 403)
        self.assertEqual(self.guard.call("GET", "/api/incidents?status=closed")[0], 200)


JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 60
b64 = lambda raw: base64.b64encode(raw).decode()


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.vil, self.guard = as_role(self.app, "villager"), as_role(self.app, "guard")

    def report(self, attachments):
        return self.vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Sanis", "attachments": attachments})

    def test_report_with_photo_and_voice(self):
        s, inc = self.report([{"kind": "photo", "data": "data:image/jpeg;base64," + b64(JPEG)}, {"kind": "voice", "data": b64(WEBM)}])
        self.assertEqual(s, 200)
        self.assertEqual([(a["kind"], a["mime"], a["size"]) for a in inc["attachments"]],
                         [("photo", "image/jpeg", 64), ("voice", "audio/webm", 64)])
        s, a = self.guard.call("GET", f"/api/attachments/{inc['attachments'][0]['id']}")
        self.assertEqual(base64.b64decode(a["data"]), JPEG)

    def test_type_comes_from_content_not_label(self):
        html = b"<html><script>alert(1)</script></html>"
        s, d = self.report([{"kind": "photo", "data": "data:image/jpeg;base64," + b64(html)}])
        self.assertEqual((s, d["field"]), (415, "attachments"))
        self.assertEqual(self.report([{"kind": "voice", "data": b64(JPEG)}])[0], 415)
        self.assertEqual(self.report([{"kind": "photo", "data": "not base64!"}])[0], 400)
        self.assertEqual(self.report([{"kind": "video", "data": b64(JPEG)}])[0], 400)

    def test_size_and_count_limits(self):
        big = JPEG + b"\x00" * 1_500_000
        self.assertEqual(self.report([{"kind": "photo", "data": b64(big)}])[0], 413)
        s, d = self.report([{"kind": "voice", "data": b64(WEBM)}] * 3)
        self.assertEqual((s, d["error"]), (400, "A report can have up to 2 voice notes."))
        self.assertEqual(self.app.store.one("SELECT COUNT(*) AS n FROM incidents")["n"], 13)  # nothing saved

    def test_add_later_and_permissions(self):
        iid = self.report([])[1]["id"]
        other = Client(self.app)
        other.call("POST", "/api/auth/register", {"name": "Other", "phone": "9123456789", "village": "Sanis", "pin": "4817"})
        other.login("9123456789", "4817")
        self.assertEqual(other.call("POST", f"/api/incidents/{iid}/attachments", {"kind": "photo", "data": b64(JPEG)})[0], 403)
        s, inc = self.guard.call("POST", f"/api/incidents/{iid}/attachments", {"kind": "photo", "data": b64(JPEG)})
        self.assertEqual((s, len(inc["attachments"])), (200, 1))
        self.assertEqual(inc["events"][-1]["note"], "Added a photo")
        self.assertFalse(other.call("GET", f"/api/incidents/{iid}")[1]["can_attach"])

    def test_csv_counts_media(self):
        self.report([{"kind": "photo", "data": b64(JPEG)}, {"kind": "photo", "data": b64(JPEG)}])
        off = as_role(self.app, "officer")
        rows = list(csv.reader(io.StringIO(off.call("GET", "/api/export.csv")[1])))
        self.assertEqual(rows[0][-2:], ["photos", "voice_notes"])
        self.assertEqual(rows[-1][-2:], ["2", "0"])


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.vil, self.guard = as_role(self.app, "villager"), as_role(self.app, "guard")

    def test_send_and_supersede_with_all_clear(self):
        self.assertEqual(self.vil.call("POST", "/api/alerts", {"level": "warning", "message": "x", "villages": ["Wozhuro"]})[0], 403)
        self.assertEqual(self.guard.call("POST", "/api/alerts", {"level": "warning", "message": "x", "villages": []})[1]["field"], "villages")
        self.assertIsNotNone(self.vil.call("GET", "/api/overview")[1]["warning"])  # sample warning covers Wozhuro
        self.clock.t += 1000
        s, a = self.guard.call("POST", "/api/alerts", {"level": "all_clear", "message": "Herd gone", "villages": ["Wozhuro", "Tening"]})
        self.assertEqual(s, 200)
        self.assertIsNone(self.vil.call("GET", "/api/overview")[1]["warning"])

    def test_warning_expires_after_a_day(self):
        self.clock.t += domain.DAY_MS
        self.assertIsNone(self.vil.call("GET", "/api/overview")[1]["warning"])

    def test_nearby_villages(self):
        near = self.guard.call("GET", "/api/incidents/1/villages?km=5")[1]
        self.assertEqual(near[0]["name"], "Tening")
        self.assertTrue(all(v["km"] <= 5 for v in near))


class StatsTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.off = as_role(self.app, "officer")

    def test_stats_numbers(self):
        s, st = self.off.call("GET", "/api/stats?days=30")
        self.assertEqual(s, 200)
        self.assertEqual(st["total"], 12)  # the 45-day-old sample is outside the window
        self.assertEqual(st["open"], 5)
        self.assertEqual(st["false_reports"], 1)
        self.assertEqual(len(st["series"]), 30)
        self.assertEqual(sum(d["count"] for d in st["series"]), 12)
        # response hours of the 30-day samples: 3, 1.2, 5, 6.5, 2.5, 1.6, 9, 4
        self.assertEqual(st["median_response_h"], 3.5)
        self.assertEqual(st["property_inr"], 87000)

    def test_officer_only(self):
        guard = as_role(self.app, "guard")
        self.assertEqual(guard.call("GET", "/api/stats")[0], 403)
        self.assertEqual(guard.call("GET", "/api/export.csv")[0], 403)

    def test_csv_export(self):
        vil = as_role(self.app, "villager")
        vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Sanis", "place": "=cmd()"})
        s, text = self.off.call("GET", "/api/export.csv?days=90")
        rows = list(csv.reader(io.StringIO(text)))
        self.assertEqual(rows[0][0], "report_no")
        self.assertEqual(len(rows), 15)
        self.assertEqual(rows[-1][13], "'=cmd()")

    def test_clear_sample(self):
        self.assertEqual(self.off.call("DELETE", "/api/sample")[0], 200)
        self.assertEqual(self.off.call("GET", "/api/stats")[1]["total"], 0)
        self.assertFalse(self.off.call("GET", "/api/overview")[1]["has_sample"])


class FakeSms:
    enabled, mode, host = True, "auto", "sms.example"


def sms_app():
    clock = Clock()
    store = Store(pin_iterations=1000)
    store.seed(at=T0)
    return App(store, clock=clock, sms=FakeSms()), clock


def last_code(app, phone):
    row = app.store.one("SELECT body FROM outbox WHERE kind = 'otp' AND phone = ? ORDER BY id DESC LIMIT 1", (phone,))
    return row["body"].split("code: ")[1][:6]


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()

    def test_idle_expiry_and_sliding_window(self):
        c = as_role(self.app, "villager")
        self.clock.t += 20 * domain.DAY_MS
        self.assertEqual(c.call("GET", "/api/me")[0], 200)  # use refreshes the session
        self.clock.t += 25 * domain.DAY_MS
        self.assertEqual(c.call("GET", "/api/me")[0], 200)
        self.clock.t += 31 * domain.DAY_MS
        s, d = c.call("GET", "/api/me")
        self.assertEqual((s, d["error"]), (401, "Your sign-in has expired. Sign in again."))

    def test_absolute_expiry(self):
        c = as_role(self.app, "villager")
        for _ in range(7):  # stays active every 25 days...
            self.clock.t += 25 * domain.DAY_MS
            c.call("GET", "/api/me")
        self.clock.t += 10 * domain.DAY_MS  # ...but 185 days after sign-in it ends
        self.assertEqual(c.call("GET", "/api/me")[0], 401)

    def test_sign_out_everywhere_keeps_this_device(self):
        a, b = as_role(self.app, "villager"), as_role(self.app, "villager")
        self.assertEqual(a.call("POST", "/api/me/logout-all")[0], 200)
        self.assertEqual(a.call("GET", "/api/me")[0], 200)
        self.assertEqual(b.call("GET", "/api/me")[0], 401)


class LockoutTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()

    def wrong(self, c, phone="9000000001"):
        return c.call("POST", "/api/auth/login", {"phone": phone, "pin": "0000"})[0]

    def test_limits_survive_restart(self):
        c = Client(self.app)
        for _ in range(5):
            self.assertEqual(self.wrong(c), 401)
        self.assertEqual(self.wrong(c), 429)
        restarted = App(self.app.store, clock=self.clock)
        self.assertEqual(Client(restarted).call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})[0], 429)

    def test_other_network_not_blocked_by_one_attacker(self):
        attacker = Client(self.app, ip="203.0.113.9")
        for _ in range(6):
            self.wrong(attacker)
        self.assertEqual(Client(self.app, ip="10.1.1.1").call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})[0], 200)

    def test_daily_cap_per_number_and_unlock(self):
        for k in range(20):
            self.assertEqual(self.wrong(Client(self.app, ip=f"198.51.100.{k}")), 401)
        s, d = Client(self.app, ip="10.9.9.9").call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})
        self.assertEqual(s, 429)
        self.assertIn("Ask a forest officer", d["error"])
        off = as_role(self.app, "officer")
        vid = self.app.store.user_by_phone("9000000001")["id"]
        self.assertEqual(off.call("POST", f"/api/users/{vid}/unlock")[0], 200)
        self.assertEqual(Client(self.app).call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})[0], 200)

    def test_network_cap_across_numbers(self):
        c = Client(self.app, ip="192.0.2.50")
        phones = [f"98{k:08d}" for k in range(30)]
        for ph in phones:
            self.assertEqual(self.wrong(c, ph), 401)
        self.assertEqual(self.wrong(c, "9000000002"), 429)


class PinTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()

    def test_weak_pins_rejected(self):
        c = Client(self.app)
        for pin in ("1111", "1234", "987654", "0000"):
            s, d = c.call("POST", "/api/auth/register", {"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": pin})
            self.assertEqual((s, d["field"]), (400, "pin"), pin)

    def test_change_pin(self):
        a, b = as_role(self.app, "villager"), as_role(self.app, "villager")
        self.assertEqual(a.call("POST", "/api/me/pin", {"old_pin": "9999", "pin": "482913"})[1]["field"], "old_pin")
        self.assertEqual(a.call("POST", "/api/me/pin", {"old_pin": "1111", "pin": "482913"})[0], 200)
        self.assertEqual(a.call("GET", "/api/me")[0], 200)
        self.assertEqual(b.call("GET", "/api/me")[0], 401)  # other devices signed out
        Client(self.app).login("9000000001", "482913")

    def test_officer_reset_forces_new_pin(self):
        off = as_role(self.app, "officer")
        vid = self.app.store.user_by_phone("9000000001")["id"]
        temp = off.call("POST", f"/api/users/{vid}/reset-pin")[1]["temp_pin"]
        v = Client(self.app)
        user = v.login("9000000001", temp)
        self.assertTrue(user["must_change_pin"])
        s, d = v.call("GET", "/api/overview")
        self.assertEqual((s, d["error"]), (403, "Choose a new PIN first."))
        self.assertEqual(v.call("POST", "/api/me/pin", {"old_pin": temp, "pin": "583920"})[0], 200)
        self.assertEqual(v.call("GET", "/api/overview")[0], 200)
        self.assertEqual(self.app.store.audit_log()[0]["action"], "pin_reset")


class AdminTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.off = as_role(self.app, "officer")

    def test_only_officers(self):
        for role in ("villager", "guard"):
            c = as_role(self.app, role)
            self.assertEqual(c.call("GET", "/api/users")[0], 403)
            self.assertEqual(c.call("GET", "/api/villages")[0], 403)
            self.assertEqual(c.call("GET", "/api/outbox")[0], 403)

    def test_role_and_switch_off(self):
        people = self.off.call("GET", "/api/users?q=Yanbeni")[1]
        self.assertEqual(len(people), 1)
        vid = people[0]["id"]
        v = as_role(self.app, "villager")
        s, u = self.off.call("PATCH", f"/api/users/{vid}", {"role": "guard"})
        self.assertEqual((s, u["role"]), (200, "guard"))
        self.assertEqual(v.call("GET", "/api/me")[0], 401)  # role change signs them out
        self.off.call("PATCH", f"/api/users/{vid}", {"active": False})
        s, d = Client(self.app).call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})
        self.assertEqual(s, 403)

    def test_officer_safeguards(self):
        me = self.app.store.user_by_phone("9000000003")["id"]
        self.assertEqual(self.off.call("PATCH", f"/api/users/{me}", {"role": "guard"})[0], 400)
        gid = self.app.store.user_by_phone("9000000002")["id"]
        self.off.call("PATCH", f"/api/users/{gid}", {"role": "officer"})
        g = as_role(self.app, "guard")  # now an officer
        self.assertEqual(g.call("PATCH", f"/api/users/{me}", {"role": "villager"})[0], 200)
        self.assertEqual(g.call("PATCH", f"/api/users/{gid}", {"active": False})[0], 400)  # self

    def test_status(self):
        s, st = self.off.call("GET", "/api/admin/status")
        self.assertEqual(s, 200)
        self.assertFalse(st["sms"]["enabled"])
        self.assertEqual(st["storage"]["incidents"], 13)


class VillageAdminTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.off = as_role(self.app, "officer")

    def test_add_edit_and_use(self):
        s, v = self.off.call("POST", "/api/villages", {"name": "Merapani", "lat": 26.36, "lng": 94.07, "verified": True, "source": "Survey of India sheet"})
        self.assertEqual(s, 200)
        self.assertEqual(self.off.call("POST", "/api/villages", {"name": "merapani", "lat": 26.3, "lng": 94.0})[0], 409)
        self.assertEqual(self.off.call("POST", "/api/villages", {"name": "Far", "lat": 12.0, "lng": 77.0})[1]["field"], "lat")
        self.assertEqual(self.off.call("POST", "/api/villages", {"name": "Nosrc", "lat": 26.2, "lng": 94.1, "verified": True})[1]["field"], "source")
        names = [x["name"] for x in Client(self.app).call("GET", "/api/meta")[1]["villages"]]
        self.assertIn("Merapani", names)
        vil = as_role(self.app, "villager")
        self.assertEqual(vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Merapani"})[0], 200)
        self.off.call("PATCH", f"/api/villages/{v['id']}", {"active": False})
        self.assertEqual(vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Merapani"})[1]["field"], "village")
        s, w = self.off.call("PATCH", "/api/villages/2", {"lat": 26.0901, "lng": 94.2421, "verified": True, "source": "GPS survey"})
        self.assertTrue(w["verified"])
        self.assertEqual(self.off.call("GET", "/api/villages")[1][1]["people"], 1)  # demo villager lives in Wozhuro

    def test_csv_import(self):
        text = "name,lat,lng,source\nLotsu,26.25,94.10,Census 2011\nWozhuro,26.0905,94.2430,GPS\nBad,abc,94.1,\nToo far,10,10,x\n"
        s, r = self.off.call("POST", "/api/villages/import", {"csv": text})
        self.assertEqual((r["added"], r["updated"], r["skipped"], r["skipped_lines"]), (1, 1, 2, [4, 5]))
        w = self.app.store.village("Wozhuro")
        self.assertTrue(w["verified"])
        self.assertEqual((w["lat"], w["source"]), (26.0905, "GPS"))
        self.assertEqual(self.off.call("POST", "/api/villages/import", {"csv": "a,b\n1,2"})[0], 400)


class PrivacyLimitTests(unittest.TestCase):
    def setUp(self):
        self.app, self.clock = make_app()
        self.vil = as_role(self.app, "villager")

    def test_other_villagers_cannot_see_photos(self):
        jpeg = b64(JPEG)
        inc = self.vil.call("POST", "/api/incidents", {"type": "injury", "village": "Sanis", "attachments": [{"kind": "photo", "data": jpeg}]})[1]
        other = Client(self.app)
        other.call("POST", "/api/auth/register", {"name": "Other", "phone": "9123456789", "village": "Sanis", "pin": "4817"})
        other.login("9123456789", "4817")
        seen = other.call("GET", f"/api/incidents/{inc['id']}")[1]
        self.assertEqual((seen["attachments"], seen["attachments_hidden"]), ([], 1))
        aid = inc["attachments"][0]["id"]
        self.assertEqual(other.call("GET", f"/api/attachments/{aid}")[0], 403)
        self.assertEqual(as_role(self.app, "guard").call("GET", f"/api/attachments/{aid}")[0], 200)
        self.assertEqual(self.vil.call("GET", f"/api/attachments/{aid}")[0], 200)

    def test_report_rate_limit(self):
        for _ in range(20):
            self.assertEqual(self.vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Sanis"})[0], 200)
        self.assertEqual(self.vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Sanis"})[0], 429)
        self.clock.t += domain.HOUR_MS + 1
        self.assertEqual(self.vil.call("POST", "/api/incidents", {"type": "sighting", "village": "Sanis"})[0], 200)

    def test_resend_does_not_duplicate(self):
        body = {"type": "sighting", "village": "Sanis", "client_id": "a1b2c3d4e5f6a7b8"}
        a = self.vil.call("POST", "/api/incidents", body)[1]
        b = self.vil.call("POST", "/api/incidents", body)[1]
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(self.app.store.one("SELECT COUNT(*) AS n FROM incidents")["n"], 14)
        self.assertEqual(self.vil.call("POST", "/api/incidents", {**body, "client_id": "x"})[1]["field"], "client_id")


class SmsTests(unittest.TestCase):
    def test_alert_messages_manual_without_provider(self):
        app, clock = make_app()
        g = as_role(app, "guard")
        s, a = g.call("POST", "/api/alerts", {"level": "warning", "message": "Herd near school", "villages": ["Wozhuro", "Baghty"]})
        self.assertEqual(a["sms"], {"recipients": 2, "mode": "manual"})  # demo villager + guard live there
        off = as_role(app, "officer")
        box = off.call("GET", "/api/outbox")[1]
        batch = box["batches"][0]
        self.assertEqual(batch["counts"], {"manual": 2})
        self.assertTrue(batch["text"].startswith("HatiAlert Elephant warning (Wozhuro, Baghty): Herd near school"))
        ids = [r["id"] for r in batch["recipients"]]
        self.assertEqual(off.call("POST", "/api/outbox/mark", {"ids": ids, "status": "sent"})[1]["updated"], 2)
        self.assertEqual(off.call("POST", "/api/outbox/mark", {"ids": ids, "status": "queued"})[0], 409)

    def test_opt_out(self):
        app, clock = make_app()
        v = as_role(app, "villager")
        v.call("PATCH", "/api/me", {"sms_alerts": False})
        a = as_role(app, "guard").call("POST", "/api/alerts", {"level": "info", "message": "x", "villages": ["Wozhuro"]})[1]
        self.assertEqual(a["sms"]["recipients"], 0)

    def test_delivery_and_retry(self):
        from hatialert import sms
        app, clock = sms_app()
        as_role(app, "guard").call("POST", "/api/alerts", {"level": "warning", "message": "x", "villages": ["Wozhuro"]})

        class Flaky:
            calls = 0
            def send(self, phone, text):
                Flaky.calls += 1
                if Flaky.calls == 1:
                    raise OSError("timeout")
        self.assertEqual(sms.deliver_due(app.store, Flaky(), now=T0), 0)
        self.assertEqual(sms.deliver_due(app.store, Flaky(), now=T0 + 1000), 0)  # waiting for the retry time
        self.assertEqual(sms.deliver_due(app.store, Flaky(), now=T0 + 61_000), 1)
        self.assertEqual(app.store.outbox_counts(), {"sent": 1})

    def test_payload_template(self):
        from hatialert.sms import SmsConfig
        cfg = SmsConfig({"HATIALERT_SMS_URL": "https://sms.example/send", "HATIALERT_SMS_BODY": '{"to":"{to}","text":"{message}"}'})
        self.assertEqual(json.loads(cfg.payload("9000000001", 'Herd "near" school')), {"to": "+919000000001", "text": 'Herd "near" school'})
        self.assertEqual((cfg.enabled, cfg.mode, cfg.host), (True, "auto", "sms.example"))
        self.assertFalse(SmsConfig({}).enabled)


class OtpTests(unittest.TestCase):
    def test_disabled_without_sms(self):
        app, _ = make_app()
        c = Client(app)
        self.assertEqual(c.call("POST", "/api/auth/otp", {"phone": "9876543210", "purpose": "register"})[0], 409)
        s, d = c.call("POST", "/api/auth/register", {"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": "4817"})
        self.assertFalse(d["user"]["phone_verified"])

    def test_register_with_code(self):
        app, clock = sms_app()
        c = Client(app)
        body = {"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": "4817"}
        self.assertEqual(c.call("POST", "/api/auth/register", body)[1]["field"], "code")  # no code yet
        c.call("POST", "/api/auth/otp", {"phone": "9876543210", "purpose": "register"})
        code = last_code(app, "9876543210")
        self.assertEqual(c.call("POST", "/api/auth/register", {**body, "code": "000000" if code != "000000" else "111111"})[1]["error"], "That code isn't right.")
        s, d = c.call("POST", "/api/auth/register", {**body, "code": code})
        self.assertEqual(s, 200)
        self.assertTrue(d["user"]["phone_verified"])
        self.assertEqual(c.call("POST", "/api/auth/register", {**body, "code": code})[0], 409)

    def test_code_expiry_tries_and_rate(self):
        app, clock = sms_app()
        c = Client(app)
        c.call("POST", "/api/auth/otp", {"phone": "9876543210", "purpose": "register"})
        body = {"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": "4817"}
        for _ in range(5):
            c.call("POST", "/api/auth/register", {**body, "code": "abcdef"})
        self.assertEqual(c.call("POST", "/api/auth/register", {**body, "code": last_code(app, "9876543210")})[0], 429)
        c.call("POST", "/api/auth/otp", {"phone": "9876543210", "purpose": "register"})
        clock.t += 11 * 60_000
        self.assertEqual(c.call("POST", "/api/auth/register", {**body, "code": last_code(app, "9876543210")})[1]["error"],
                         "That code has expired. Ask for a new one.")
        c.call("POST", "/api/auth/otp", {"phone": "9876543210", "purpose": "register"})
        self.assertEqual(c.call("POST", "/api/auth/otp", {"phone": "9876543210", "purpose": "register"})[0], 429)

    def test_forgot_pin(self):
        app, clock = sms_app()
        c = Client(app)
        s, d = c.call("POST", "/api/auth/otp", {"phone": "9811111111", "purpose": "reset"})  # unknown number
        self.assertEqual(s, 200)  # same answer either way
        self.assertIsNone(app.store.one("SELECT 1 AS x FROM outbox WHERE phone = '9811111111'"))
        old = as_role(app, "villager")
        c.call("POST", "/api/auth/otp", {"phone": "9000000001", "purpose": "reset"})
        s, d = c.call("POST", "/api/auth/reset", {"phone": "9000000001", "code": last_code(app, "9000000001"), "pin": "582047"})
        self.assertEqual(s, 200)
        self.assertEqual(old.call("GET", "/api/me")[0], 401)
        Client(app).login("9000000001", "582047")


class OpsTests(unittest.TestCase):
    def test_backup_copy(self):
        import tempfile
        import sqlite3
        app, _ = make_app()
        with tempfile.TemporaryDirectory() as d:
            path = f"{d}/b.db"
            app.store.backup(path)
            n = sqlite3.connect(path).execute("SELECT COUNT(*) FROM incidents").fetchone()[0]
        self.assertEqual(n, 13)

    def test_backup_rotation(self):
        import tempfile
        from hatialert.__main__ import run_backup
        app, _ = make_app()
        with tempfile.TemporaryDirectory() as d:
            for k in range(5):
                run_backup(app.store, d, keep=3, stamp=f"2026100{k}-000000")
            names = sorted(p.name for p in Path(d).iterdir())
        self.assertEqual(names, ["hatialert-20261002-000000.db", "hatialert-20261003-000000.db", "hatialert-20261004-000000.db"])

    def test_migrates_old_database(self):
        import sqlite3
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = f"{d}/old.db"
            old = sqlite3.connect(path)
            old.executescript("""CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
                village TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'villager', radius_km REAL NOT NULL DEFAULT 5,
                pin_hash TEXT NOT NULL, sample INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
                CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
                INSERT INTO users (name, phone, village, pin_hash, created_at) VALUES ('Old', '9000000009', 'Sanis', 'x', 1);
                INSERT INTO sessions VALUES ('tok', 1, 5);""")
            old.commit(); old.close()
            st = Store(path)
            u = st.user_by_token("tok")
            self.assertEqual((u["active"], u["sms_alerts"], u["_session_seen"]), (1, 1, 5))
            self.assertEqual(len(st.villages()), 10)


if __name__ == "__main__":
    unittest.main()
