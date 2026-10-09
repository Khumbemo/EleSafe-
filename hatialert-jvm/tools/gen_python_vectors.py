#!/usr/bin/env python3
"""Write the numeric expectations the JVM port is checked against.

Runs the reference Python code (hatialert-py/hatialert/domain.py and geo.py)
and prints JSON. The output is committed as
core/src/test/resources/python-vectors.json; PythonVectorsTest asserts the
Java port matches it, and (when Python is installed) that this script still
produces exactly that file, so a change on the Python side fails the build
until the fixture is regenerated:

    python3 tools/gen_python_vectors.py > core/src/test/resources/python-vectors.json
"""

import argparse
import json
import math
import sys
from pathlib import Path


def main():
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--py-dir", default=str(here.parent.parent / "hatialert-py"),
                    help="hatialert-py folder (default: ../hatialert-py next to hatialert-jvm)")
    args = ap.parse_args()
    sys.path.insert(0, args.py_dir)
    from hatialert import domain, geo  # noqa: E402

    V = domain.VILLAGES
    out = {"source": "hatialert-py domain.py + geo.py via tools/gen_python_vectors.py"}

    out["constants"] = {
        "earth_radius_km": domain.EARTH_RADIUS_KM,
        "utm_A": geo.A, "utm_alpha": list(geo.ALPHA), "utm_beta": list(geo.BETA), "utm_delta": list(geo.DELTA),
    }

    meta = domain.meta()
    out["meta"] = {k: meta[k] for k in ("villages", "types", "severities", "statuses", "transitions",
                                        "transition_roles", "alert_levels", "directions", "limits", "media", "contacts")}
    out["meta"]["roles"] = domain.ROLES
    out["meta"]["staff"] = list(domain.STAFF)

    kinds = list(domain.INCIDENT_TYPES) + ["unknown"]
    out["severity"] = [[k, h, c, domain.classify_severity(k, h, c)]
                       for k in kinds for h in (0, 1, 4, 5, 9, 10, 11, 200) for c in (0, 1, 2)]

    bearings = [-720.0, -45.0, -22.5, -22.4, -0.0, 0.0, 22.4, 22.5, 22.6, 67.5, 112.5, 157.5, 202.5, 247.5,
                292.5, 337.4, 337.5, 359.0, 359.999, 360.0, 720.1]
    bearings += [round(i * 7.3, 1) for i in range(50)]
    out["compass"] = [[b, domain.compass(b)] for b in bearings]

    pts = [(v["lat"], v["lng"]) for v in V] + [(26.0, 94.0), (27.0, 94.0), (0.0, 0.0), (0.0, 180.0), (-33.9, 18.4)]
    out["pairs"] = []
    for a in pts:
        for b in pts:
            br = domain.bearing_deg(*a, *b)
            out["pairs"].append([a[0], a[1], b[0], b[1], domain.haversine_km(*a, *b), br, domain.compass(br)])

    out["destination"] = []
    for v in V:
        for d in domain.DIRECTIONS + ["", "UP"]:
            for km in (0.0, 0.5, 1.0, 3.0, 15.0, -1.0):
                lat, lng = domain.destination(v["lat"], v["lng"], km, d)
                out["destination"].append([v["lat"], v["lng"], km, d, lat, lng])

    # Unrounded destination on any bearing: the formula app.js uses for the alert ring.
    def dest_deg(lat, lng, km, deg):
        theta = math.radians(deg)
        delta = km / domain.EARTH_RADIUS_KM
        p1, l1 = math.radians(lat), math.radians(lng)
        p2 = math.asin(math.sin(p1) * math.cos(delta) + math.cos(p1) * math.sin(delta) * math.cos(theta))
        l2 = l1 + math.atan2(math.sin(theta) * math.sin(delta) * math.cos(p1), math.cos(delta) - math.sin(p1) * math.sin(p2))
        return math.degrees(p2), math.degrees(l2)

    home = V[0]
    out["destination_bearing"] = [[home["lat"], home["lng"], km, deg, *dest_deg(home["lat"], home["lng"], km, deg)]
                                  for km in (5.0, 25.0) for deg in range(0, 361, 5)]

    fwd = [(v["lat"], v["lng"]) for v in V]
    fwd += [(25.5 + 0.25 * i, 93.5 + 0.25 * j) for i in range(7) for j in range(7)]
    fwd += [(26.09717, 94.25817), (25.9208, 93.9549), (26.5595, 94.3908), (0.0, 93.0), (26.0, 90.0), (26.0, 96.0), (60.0, 95.0)]
    out["utm_forward"] = [[lat, lon, *geo.utm(lat, lon)] for lat, lon in fwd]
    inv = [(e, n) for e in (166_000.0, 400_000.0, 500_000.0, 595_630.908, 625_817.193, 700_000.0, 833_000.0)
           for n in (0.0, 2_800_000.0, 2_867_261.356, 2_887_052.62, 2_938_399.207, 3_100_000.0)]
    out["utm_inverse"] = [[e, n, *geo.utm_inverse(e, n)] for e, n in inv]

    times = [1_790_000_000_000, 1_790_794_800_000, 1_790_794_799_999, 1_798_741_799_999, 1_798_741_800_000,
             1_835_375_400_000, 1_835_375_399_999, 1_790_792_999_999, 1_790_793_000_000, 0, -1, 946_684_800_000, 1_000_000_000_123, 4_102_444_800_000]
    out["ist"] = [[ms, domain.ist_date(ms), domain.ist_stamp(ms)] for ms in times]
    out["reference"] = [[i, ms, domain.reference(i, ms)] for i in (1, 7, 42, 999, 9999, 12345) for ms in times]

    heads = ["ffd8ffe000104a464946", "89504e470d0a1a0a0000", "52494646000000005745425056503820",
             "52494646000000005741564566", "1a45dfa39f4286810142", "4f67675300020000", "000000206674797069736f6d",
             "49443303000000", "fffb9064", "fff3", "fff2", "fffa", "fff1", "ff", "", "3c68746d6c3e",
             "52494646000000004156492020", "ffd8"]
    out["sniff"] = [[h, domain.sniff_media(bytes.fromhex(h))] for h in heads]

    json.dump(out, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
