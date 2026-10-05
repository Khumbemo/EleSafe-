"""Domain rules for HatiAlert: places, incident types, severity, geography.

Everything here is plain data or a pure function, so it behaves the same on
the server, in tests and in the in-browser (Pyodide) preview.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

# Nagaland keeps Indian Standard Time; all day boundaries use it.
IST = timezone(timedelta(hours=5, minutes=30), "IST")

DAY_MS = 86_400_000
HOUR_MS = 3_600_000

# Village points. Only Wokha Town is checked against a gazetteer (GeoNames).
# The others came from the original app (src/utils/constants.js); they all
# fall inside the Census 2011 district outline but have not been verified,
# and the app marks them as such. Replace them with Survey of India, Census
# or OpenStreetMap points before field use, and set "verified".
_UNVERIFIED = "Original app, not verified"
VILLAGES = [
    {"name": "Wokha Town", "lat": 26.09717, "lng": 94.25817, "verified": True, "source": "GeoNames gazetteer"},
    {"name": "Wozhuro", "lat": 26.0912, "lng": 94.2434, "verified": False, "source": _UNVERIFIED},
    {"name": "Baghty", "lat": 26.0780, "lng": 94.2200, "verified": False, "source": _UNVERIFIED},
    {"name": "Sanis", "lat": 26.1230, "lng": 94.2890, "verified": False, "source": _UNVERIFIED},
    {"name": "Ralan", "lat": 26.0650, "lng": 94.2750, "verified": False, "source": _UNVERIFIED},
    {"name": "Englan", "lat": 26.1450, "lng": 94.3100, "verified": False, "source": _UNVERIFIED},
    {"name": "Tening", "lat": 26.0500, "lng": 94.2100, "verified": False, "source": _UNVERIFIED},
    {"name": "Bhandari", "lat": 26.1600, "lng": 94.2400, "verified": False, "source": _UNVERIFIED},
    {"name": "Longsa", "lat": 26.0300, "lng": 94.3200, "verified": False, "source": _UNVERIFIED},
    {"name": "Wosanda", "lat": 26.1100, "lng": 94.3400, "verified": False, "source": _UNVERIFIED},
]
VILLAGE_BY_NAME = {v["name"]: v for v in VILLAGES}

INCIDENT_TYPES = {
    "sighting": {"label": "Elephant sighted", "local": "Hati dekha"},
    "herd_movement": {"label": "Herd moving", "local": "Pal jaache"},
    "crop_raid": {"label": "Crop raid", "local": "Kheti barbad"},
    "property_damage": {"label": "Property damage", "local": "Ghar tuta"},
    "injury": {"label": "Person injured", "local": "Manuh ahata"},
    "death": {"label": "Person killed", "local": "Manuh mara"},
}

SEVERITIES = ["critical", "high", "medium", "low"]
SEVERITY_LABELS = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low"}

STATUSES = ["reported", "verified", "responded", "resolved", "false_report"]
STATUS_LABELS = {
    "reported": "Reported",
    "verified": "Verified",
    "responded": "Team responded",
    "resolved": "Resolved",
    "false_report": "False report",
}
OPEN_STATUSES = ("reported", "verified", "responded")

# Which status may follow which, and who may make the move.
TRANSITIONS = {
    "reported": ["verified", "false_report"],
    "verified": ["responded", "false_report"],
    "responded": ["resolved"],
    "resolved": [],
    "false_report": [],
}
TRANSITION_ROLES = {
    "verified": ("guard", "officer"),
    "responded": ("guard", "officer"),
    "false_report": ("guard", "officer"),
    "resolved": ("officer",),
}

ROLES = ["villager", "guard", "officer"]
STAFF = ("guard", "officer")

ALERT_LEVELS = {
    "warning": "Elephant warning",
    "info": "Information",
    "all_clear": "All clear",
}

DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]

LIMITS = {
    "herd_size": (0, 200),
    "casualties": (0, 50),
    "crop_acres": (0.0, 500.0),
    "property_inr": (0, 10_000_000),
    "offset_km": (0.0, 15.0),
    "radius_km": (1.0, 25.0),
    "description": 500,
    "message": 400,
    "name": 60,
}


# Photos and voice notes. The type is read from the file's first bytes; the
# name or type a phone reports is ignored.
MEDIA = {
    "photo": {"mimes": ["image/jpeg", "image/png", "image/webp"], "max_bytes": 1_500_000, "max_count": 6},
    "voice": {"mimes": ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"], "max_bytes": 2_000_000, "max_count": 2},
}
VOICE_MAX_SECONDS = 60


def sniff_media(head: bytes) -> str | None:
    """Media type from a file's leading bytes (16 are enough)."""
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "audio/webm"
    if head[:4] == b"OggS":
        return "audio/ogg"
    if head[4:8] == b"ftyp":
        return "audio/mp4"
    if head[:3] == b"ID3" or (len(head) > 1 and head[0] == 0xFF and head[1] in (0xFB, 0xF3, 0xF2, 0xFA)):
        return "audio/mpeg"
    return None


def classify_severity(kind: str, herd_size: int, casualties: int) -> str:
    """Severity rules carried over unchanged from the original app."""
    if casualties > 0 or kind in ("death", "injury"):
        return "critical"
    if kind == "property_damage":
        return "high"
    if kind == "crop_raid":
        return "high" if herd_size >= 5 else "medium"
    if kind == "herd_movement" and herd_size >= 10:
        return "high"
    if kind == "sighting" and herd_size >= 5:
        return "medium"
    return "low"


EARTH_RADIUS_KM = 6371.0088  # IUGG mean Earth radius


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass(bearing: float) -> str:
    return DIRECTIONS[int((bearing % 360) / 45 + 0.5) % 8]


def destination(lat: float, lng: float, km: float, direction: str) -> tuple[float, float]:
    """Point `km` away from (lat, lng) heading `direction` (e.g. "NE")."""
    if km <= 0 or direction not in DIRECTIONS:
        return lat, lng
    theta = math.radians(DIRECTIONS.index(direction) * 45)
    delta = km / EARTH_RADIUS_KM
    p1, l1 = math.radians(lat), math.radians(lng)
    p2 = math.asin(math.sin(p1) * math.cos(delta) + math.cos(p1) * math.sin(delta) * math.cos(theta))
    l2 = l1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(p1),
        math.cos(delta) - math.sin(p1) * math.sin(p2),
    )
    return round(math.degrees(p2), 5), round(math.degrees(l2), 5)


def ist_date(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, IST).strftime("%Y-%m-%d")


def ist_stamp(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, IST).strftime("%Y-%m-%d %H:%M")


def reference(incident_id: int, created_ms: int) -> str:
    """Report number villagers quote on compensation claims, e.g. HA-2610-0007."""
    return "HA-" + datetime.fromtimestamp(created_ms / 1000, IST).strftime("%y%m") + f"-{incident_id:04d}"


# Reference content shown in the app. Nagamese lines are from the original
# app; new English lines have no translation yet (empty string).
# Phone numbers marked placeholder came from the original app and are not
# real forest-department lines.
CONTACTS = [
    {"name": "National emergency", "phone": "112", "role": "Police, fire, ambulance", "placeholder": False},
    {"name": "Ambulance", "phone": "108", "role": "Emergency medical", "placeholder": False},
    {"name": "Police", "phone": "100", "role": "Police control room", "placeholder": False},
    {"name": "Forest control room, Wokha", "phone": "+91 94360 00000", "role": "24/7 forest helpline", "placeholder": True},
    {"name": "DFO Wokha", "phone": "+91 94360 00001", "role": "Divisional Forest Officer", "placeholder": True},
    {"name": "Range Officer, Baghty", "phone": "+91 94360 00002", "role": "Range Forest Officer", "placeholder": True},
]

SAFETY = {
    "do": [
        ("Keep well back from the herd and stay downwind", ""),
        ("Stay together in groups", "Ekelog te thakibi"),
        ("Make noise only from a safe distance (pots, horns)", "Dhur para awaz koribi"),
        ("Warn neighbours at once", "Osorkhan ke jaldi khobor dibi"),
        ("Report in HatiAlert straight away", "HatiAlert te jaldi report koribi"),
    ],
    "dont": [
        ("Approach the herd or stop to take photos", "Photo lobole osorte na-jabi"),
        ("Block or corner an elephant's path", "Hati laga rasta na-bondh koribi"),
        ("Throw crackers near calves; it can panic the herd", "Bacha osorte bom na-phutabi"),
        ("Go to the fields alone at night during an alert", "Rati kheti te akela na-jabi"),
        ("Store rice beer or grain where a herd can reach it", ""),
    ],
}

COMPENSATION = {
    "note": "Amounts carried over from the original app. Confirm current rates with the Wokha Forest Division before filing.",
    "rates": [
        ("Human death", "₹5,00,000"),
        ("Permanent disability", "₹2,00,000 – ₹4,00,000"),
        ("Grievous injury", "₹50,000 – ₹1,50,000"),
        ("Simple injury", "₹25,000"),
        ("Crop damage", "As assessed by the range officer"),
        ("House damage", "As assessed (replacement cost)"),
    ],
    "steps": [
        "Report the incident within 24 hours and note the HA- report number",
        "A forest guard verifies and records the damage",
        "Submit the claim form at the Wokha Range Office",
        "Payment follows verification",
    ],
    "documents": [
        "Aadhaar card",
        "HatiAlert report number",
        "Medical certificate (injuries)",
        "Land record (crop damage)",
    ],
}


def meta() -> dict:
    """Everything the UI needs to draw forms and reference pages."""
    return {
        "villages": VILLAGES,
        "types": [{"key": k, **v} for k, v in INCIDENT_TYPES.items()],
        "severities": [{"key": k, "label": SEVERITY_LABELS[k]} for k in SEVERITIES],
        "statuses": [{"key": k, "label": STATUS_LABELS[k], "open": k in OPEN_STATUSES} for k in STATUSES],
        "transitions": TRANSITIONS,
        "transition_roles": {k: list(v) for k, v in TRANSITION_ROLES.items()},
        "alert_levels": [{"key": k, "label": v} for k, v in ALERT_LEVELS.items()],
        "directions": DIRECTIONS,
        "limits": LIMITS,
        "media": {**MEDIA, "voice_max_seconds": VOICE_MAX_SECONDS},
        "contacts": CONTACTS,
        "safety": {k: [{"text": t, "local": n} for t, n in v] for k, v in SAFETY.items()},
        "compensation": {
            **COMPENSATION,
            "rates": [{"item": a, "amount": b} for a, b in COMPENSATION["rates"]],
        },
    }
