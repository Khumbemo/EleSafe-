import base64
import csv
import io
import json
import math
import unittest

from hatialert import domain, security
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
    def __init__(self, app):
        self.app, self.token = app, None

    def call(self, method, path, body=None):
        path, _, query = path.partition("?")
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
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
            ({"name": "A", "phone": "9876543210", "village": "Sanis", "pin": "1234"}, "name"),
            ({"name": "Akum", "phone": "12345", "village": "Sanis", "pin": "1234"}, "phone"),
            ({"name": "Akum", "phone": "9876543210", "village": "Paris", "pin": "1234"}, "village"),
            ({"name": "Akum", "phone": "9876543210", "village": "Sanis", "pin": "12"}, "pin"),
        ]:
            s, d = c.call("POST", "/api/auth/register", body)
            self.assertEqual((s, d["field"]), (400, field), body)

    def test_lockout_after_five_wrong_pins(self):
        c = Client(self.app)
        for _ in range(5):
            self.assertEqual(c.call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "0000"})[0], 401)
        self.assertEqual(c.call("POST", "/api/auth/login", {"phone": "9000000001", "pin": "1111"})[0], 429)
        self.clock.t += 5 * 60_000 + 1
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
        other.call("POST", "/api/auth/register", {"name": "Other", "phone": "9123456789", "village": "Sanis", "pin": "1234"})
        other.login("9123456789", "1234")
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
        other.call("POST", "/api/auth/register", {"name": "Other", "phone": "9123456789", "village": "Sanis", "pin": "1234"})
        other.login("9123456789", "1234")
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


if __name__ == "__main__":
    unittest.main()
