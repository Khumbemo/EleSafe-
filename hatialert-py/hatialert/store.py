"""SQLite storage. One connection, guarded by a lock for the threaded server."""

from __future__ import annotations

import json
import sqlite3
import threading
import time

from . import domain
from .security import SERVER_ITERATIONS, hash_pin

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    village TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'villager',
    radius_km REAL NOT NULL DEFAULT 5,
    pin_hash TEXT NOT NULL,
    sample INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reported',
    herd_size INTEGER NOT NULL DEFAULT 0,
    casualties INTEGER NOT NULL DEFAULT 0,
    crop_acres REAL NOT NULL DEFAULT 0,
    property_inr INTEGER NOT NULL DEFAULT 0,
    heading TEXT NOT NULL DEFAULT '',
    village TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sample INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS incidents_created ON incidents(created_at);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_incident ON events(incident_id);
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_incident ON attachments(incident_id);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    villages TEXT NOT NULL,
    incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sample INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL
);
"""

DEMO_ACCOUNTS = [
    {"name": "Yanbeni Ezung", "phone": "9000000001", "pin": "1111", "village": "Wozhuro", "role": "villager"},
    {"name": "Guard Renthung", "phone": "9000000002", "pin": "2222", "village": "Baghty", "role": "guard"},
    {"name": "Officer Kikon", "phone": "9000000003", "pin": "3333", "village": "Wokha Town", "role": "officer"},
]


def now_ms() -> int:
    return int(time.time() * 1000)


class Store:
    def __init__(self, path: str = ":memory:", pin_iterations: int = SERVER_ITERATIONS):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        if path != ":memory:":
            self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()
        self.pin_iterations = pin_iterations

    # -- helpers ---------------------------------------------------------
    def one(self, sql: str, args=()) -> dict | None:
        with self.lock:
            row = self.db.execute(sql, args).fetchone()
        return dict(row) if row else None

    def all(self, sql: str, args=()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def run(self, sql: str, args=()) -> int:
        with self.lock, self.db:
            return self.db.execute(sql, args).lastrowid

    # -- users -----------------------------------------------------------
    def create_user(self, name, phone, village, pin, role="villager", sample=0, at=None) -> dict:
        uid = self.run(
            "INSERT INTO users (name, phone, village, role, pin_hash, sample, created_at) VALUES (?,?,?,?,?,?,?)",
            (name, phone, village, role, hash_pin(pin, self.pin_iterations), sample, at or now_ms()),
        )
        return self.user(uid)

    def user(self, uid) -> dict | None:
        return self.one("SELECT * FROM users WHERE id = ?", (uid,))

    def user_by_phone(self, phone) -> dict | None:
        return self.one("SELECT * FROM users WHERE phone = ?", (phone,))

    def user_by_token(self, token) -> dict | None:
        return self.one(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", (token,)
        )

    def add_session(self, token, uid):
        self.run("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)", (token, uid, now_ms()))

    def drop_session(self, token):
        self.run("DELETE FROM sessions WHERE token = ?", (token,))

    def update_user(self, uid, fields: dict) -> dict:
        if fields:
            cols = ", ".join(f"{k} = ?" for k in fields)
            self.run(f"UPDATE users SET {cols} WHERE id = ?", (*fields.values(), uid))
        return self.user(uid)

    # -- incidents -------------------------------------------------------
    def add_attachment(self, iid, kind, mime, data: bytes, uid, at, cur=None) -> int:
        args = (iid, kind, mime, len(data), data, uid, at)
        sql = "INSERT INTO attachments (incident_id, kind, mime, size, data, user_id, created_at) VALUES (?,?,?,?,?,?,?)"
        if cur is not None:
            return cur.execute(sql, args).lastrowid
        return self.run(sql, args)

    def attachments(self, iid) -> list[dict]:
        return self.all(
            "SELECT id, kind, mime, size, user_id, created_at FROM attachments WHERE incident_id = ? ORDER BY id", (iid,)
        )

    def attachment(self, aid) -> dict | None:
        return self.one("SELECT * FROM attachments WHERE id = ?", (aid,))

    def media_counts(self) -> dict[int, dict]:
        rows = self.all("SELECT incident_id, kind, COUNT(*) AS n FROM attachments GROUP BY incident_id, kind")
        out: dict[int, dict] = {}
        for r in rows:
            out.setdefault(r["incident_id"], {})[r["kind"]] = r["n"]
        return out

    def add_incident(self, data: dict, reporter_id, at: int, sample=0, media=()) -> int:
        with self.lock, self.db:
            cur = self.db.execute(
                """INSERT INTO incidents (type, severity, status, herd_size, casualties, crop_acres,
                   property_inr, heading, village, lat, lng, place, description, reporter_id, sample,
                   created_at, updated_at) VALUES (?,?,'reported',?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    data["type"], data["severity"], data["herd_size"], data["casualties"],
                    data["crop_acres"], data["property_inr"], data["heading"], data["village"],
                    data["lat"], data["lng"], data["place"], data["description"], reporter_id,
                    sample, at, at,
                ),
            )
            iid = cur.lastrowid
            self.db.execute(
                "INSERT INTO events (incident_id, status, note, user_id, at) VALUES (?,?,?,?,?)",
                (iid, "reported", "", reporter_id, at),
            )
            for kind, mime, blob in media:
                self.add_attachment(iid, kind, mime, blob, reporter_id, at, cur=self.db)
        return iid

    def incident(self, iid) -> dict | None:
        return self.one("SELECT * FROM incidents WHERE id = ?", (iid,))

    def incidents(self, where="1=1", args=(), limit=500) -> list[dict]:
        return self.all(
            f"SELECT * FROM incidents WHERE {where} ORDER BY created_at DESC, id DESC LIMIT ?", (*args, limit)
        )

    def events(self, iid) -> list[dict]:
        return self.all(
            """SELECT e.*, u.name AS user_name, u.role AS user_role FROM events e
               LEFT JOIN users u ON u.id = e.user_id WHERE incident_id = ? ORDER BY at, e.id""",
            (iid,),
        )

    def first_event_times(self, status) -> dict[int, int]:
        rows = self.all("SELECT incident_id, MIN(at) AS at FROM events WHERE status = ? GROUP BY incident_id", (status,))
        return {r["incident_id"]: r["at"] for r in rows}

    def add_event(self, iid, status, note, uid, at, new_status=None):
        with self.lock, self.db:
            self.db.execute(
                "INSERT INTO events (incident_id, status, note, user_id, at) VALUES (?,?,?,?,?)",
                (iid, status, note, uid, at),
            )
            if new_status:
                self.db.execute("UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?", (new_status, at, iid))
            else:
                self.db.execute("UPDATE incidents SET updated_at = ? WHERE id = ?", (at, iid))

    # -- alerts ----------------------------------------------------------
    def add_alert(self, level, message, villages, incident_id, uid, at, sample=0) -> int:
        return self.run(
            "INSERT INTO alerts (level, message, villages, incident_id, user_id, sample, sent_at) VALUES (?,?,?,?,?,?,?)",
            (level, message, json.dumps(villages), incident_id, uid, sample, at),
        )

    def alerts(self, limit=50) -> list[dict]:
        rows = self.all(
            """SELECT a.*, u.name AS user_name FROM alerts a LEFT JOIN users u ON u.id = a.user_id
               ORDER BY sent_at DESC, a.id DESC LIMIT ?""",
            (limit,),
        )
        for r in rows:
            r["villages"] = json.loads(r["villages"])
        return rows

    # -- sample data -----------------------------------------------------
    def is_empty(self) -> bool:
        return self.one("SELECT COUNT(*) AS n FROM users")["n"] == 0

    def clear_sample(self):
        with self.lock, self.db:
            self.db.execute("DELETE FROM alerts WHERE sample = 1")
            self.db.execute("DELETE FROM incidents WHERE sample = 1")

    def seed(self, at: int | None = None):
        """Demo accounts plus a month of example incidents, all flagged sample."""
        t = at or now_ms()
        H, D = domain.HOUR_MS, domain.DAY_MS
        users = {
            a["role"]: self.create_user(a["name"], a["phone"], a["village"], a["pin"], a["role"], 1, t - 40 * D)
            for a in DEMO_ACCOUNTS
        }
        vil, guard, officer = users["villager"]["id"], users["guard"]["id"], users["officer"]["id"]
        # (ago, type, herd, casualties, acres, inr, village, km, dir, heading, place, history)
        # history: (status, hours after report, by, note)
        rows = [
            (0.7 * H, "herd_movement", 12, 0, 0, 0, "Tening", 1.2, "E", "E", "Ridge road above the school", []),
            (2 * H, "crop_raid", 6, 0, 1.5, 0, "Wozhuro", 0.8, "SE", "N", "Paddy fields below the village", [("verified", 0.6, "g", "Fresh dung and footprints found.")]),
            (7 * H, "sighting", 5, 0, 0, 0, "Sanis", 1.5, "S", "", "Doyang river bank", [("verified", 1.1, "g", "")]),
            (1.2 * D, "property_damage", 3, 0, 0.5, 45000, "Ralan", 0.4, "W", "S", "Granary hut at the field edge", [("verified", 1.5, "g", ""), ("responded", 3.0, "g", "Team with torches and drums sent.")]),
            (3 * D, "injury", 1, 1, 0, 0, "Longsa", 2.0, "N", "", "Path to the jhum field", [("verified", 0.5, "o", ""), ("responded", 1.2, "o", "Patient taken to Wokha district hospital.")]),
            (5 * D, "crop_raid", 4, 0, 0.6, 0, "Baghty", 0.5, "NE", "W", "Maize plots near the stream", [("verified", 2.0, "g", ""), ("responded", 5.0, "g", ""), ("resolved", 30, "o", "Claim form issued.")]),
            (8 * D, "crop_raid", 2, 0, 0.8, 0, "Englan", 0.7, "E", "", "Terraced paddy", [("verified", 3.0, "g", ""), ("responded", 6.5, "g", ""), ("resolved", 48, "o", "")]),
            (11 * D, "sighting", 1, 0, 0, 0, "Wosanda", 1.0, "SW", "", "Forest edge", [("false_report", 4.0, "g", "Tracks were a buffalo's.")]),
            (14 * D, "crop_raid", 7, 0, 3.0, 12000, "Baghty", 1.0, "S", "SW", "Paddy and fence", [("verified", 1.0, "g", ""), ("responded", 2.5, "g", ""), ("resolved", 72, "o", "Compensation recommended.")]),
            (17 * D, "herd_movement", 9, 0, 0, 0, "Tening", 2.5, "W", "N", "Crossing the state road", [("verified", 0.8, "g", ""), ("responded", 1.6, "g", ""), ("resolved", 20, "o", "")]),
            (21 * D, "property_damage", 2, 0, 0, 30000, "Wozhuro", 0.3, "N", "", "Water tank and fence", [("verified", 4.0, "g", ""), ("responded", 9.0, "g", ""), ("resolved", 96, "o", "")]),
            (26 * D, "crop_raid", 5, 0, 2.0, 0, "Ralan", 0.9, "E", "", "Banana grove", [("verified", 2.2, "g", ""), ("responded", 4.0, "g", ""), ("resolved", 60, "o", "")]),
            (45 * D, "sighting", 3, 0, 0, 0, "Bhandari", 1.0, "S", "", "Tea garden edge", [("verified", 1.0, "g", ""), ("responded", 3.0, "g", ""), ("resolved", 24, "o", "")]),
        ]
        by = {"g": guard, "o": officer}
        ids = []
        for ago, kind, herd, cas, acres, inr, village, km, d, heading, place, history in rows:
            v = domain.VILLAGE_BY_NAME[village]
            lat, lng = domain.destination(v["lat"], v["lng"], km, d)
            created = int(t - ago)
            iid = self.add_incident(
                {
                    "type": kind, "severity": domain.classify_severity(kind, herd, cas),
                    "herd_size": herd, "casualties": cas, "crop_acres": acres, "property_inr": inr,
                    "heading": heading, "village": village, "lat": lat, "lng": lng,
                    "place": place, "description": "",
                },
                vil, created, sample=1,
            )
            ids.append(iid)
            for status, hours, who, note in history:
                self.add_event(iid, status, note, by[who], int(created + hours * H), new_status=status)
        self.add_alert(
            "warning",
            "Herd of about 12 elephants moving east from Tening along the ridge road. Keep away from fields after dark.",
            ["Tening", "Baghty", "Wozhuro"], ids[0], guard, int(t - 0.6 * H), sample=1,
        )
        self.add_alert("info", "Forest guards are patrolling Sanis and Ralan tonight.", ["Sanis", "Ralan"], None, officer, int(t - 5 * H), sample=1)
        self.add_alert("all_clear", "The herd near Englan has moved back into the reserve forest.", ["Englan"], ids[6], officer, int(t - 6 * D), sample=1)
