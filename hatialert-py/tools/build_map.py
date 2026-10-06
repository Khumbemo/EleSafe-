"""Build the offline base map for HatiAlert (Wokha district, Nagaland).

    python tools/build_map.py            # needs: numpy pillow pyshp contourpy

Writes hatialert/web/map/terrain.webp (shaded relief) and
hatialert/web/map/layers.json (contours, streams, boundaries, peaks), all on
the UTM zone 46N grid (EPSG:32646, WGS 84). Only this build step needs the
extra packages; the app itself reads the two output files.

Sources
- Elevation: AWS Terrain Tiles (Mapzen "terrarium" encoding, zoom 12, about
  34 m per pixel here), which use NASA SRTM for this region. Public domain /
  open data; see https://registry.opendata.aws/terrain-tiles/
- District boundaries: Census of India 2011 districts as published by
  DataMeet (CC BY 2.5 India), https://github.com/datameet/maps
- Streams are derived from the elevation model (priority-flood depression
  filling, D8 flow directions, flow accumulation), not surveyed. Lines show
  where water would collect for catchments over 5 km².
"""

from __future__ import annotations

import heapq
import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import contourpy
import numpy as np
import shapefile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from hatialert import geo  # noqa: E402  (UTM maths shared with the app)

OUT = ROOT / "hatialert" / "web" / "map"
CACHE = Path(__file__).resolve().parent / ".cache"
UA = {"User-Agent": "HatiAlert-map-build/1.0"}
CENSUS = "https://raw.githubusercontent.com/datameet/maps/master/Districts/Census_2011/2011_Dist"
TILE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
Z = 12
RES = 40.0  # output grid, metres
MARGIN_DEG = 0.06
STREAM_MIN_KM2 = 5.0
CONTOUR_STEP = 100
MIN_CONTOUR_M = 1200
NEIGHBOURS = {"Wokha", "Mokokchung", "Zunheboto", "Kohima", "Dimapur", "Golaghat", "Karbi Anglong", "Jorhat", "Phek", "Tuensang", "Longleng"}


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
            dest.write_bytes(r.read())
    return dest


# -- elevation -----------------------------------------------------------
def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def load_dem(bbox):
    lon0, lat0, lon1, lat1 = bbox
    x0, y0 = (int(v) for v in tile_xy(lat1, lon0, Z))
    x1, y1 = (int(v) for v in tile_xy(lat0, lon1, Z))
    rows = []
    for ty in range(y0, y1 + 1):
        row = []
        for tx in range(x0, x1 + 1):
            p = fetch(TILE.format(z=Z, x=tx, y=ty), CACHE / f"t{Z}_{tx}_{ty}.png")
            a = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
            row.append(a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768)
        rows.append(np.hstack(row))
    print(f"  {(x1 - x0 + 1) * (y1 - y0 + 1)} elevation tiles")
    return np.vstack(rows), x0 * 256, y0 * 256


def sample(dem, ox, oy, lat, lon):
    """Bilinear sample of the Web-Mercator mosaic at lat/lon arrays."""
    n = 2 ** Z * 256
    px = (lon + 180) / 360 * n - ox - 0.5
    py = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - oy - 0.5
    x0 = np.clip(np.floor(px).astype(int), 0, dem.shape[1] - 2)
    y0 = np.clip(np.floor(py).astype(int), 0, dem.shape[0] - 2)
    fx, fy = np.clip(px - x0, 0, 1), np.clip(py - y0, 0, 1)
    a, b = dem[y0, x0], dem[y0, x0 + 1]
    c, d = dem[y0 + 1, x0], dem[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def hillshade(z, res, azimuth=315.0, altitude=45.0):
    """Horn (1981) slope/aspect, Lambertian shading."""
    p = np.pad(z, 1, mode="edge")
    dzdx = ((p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])) / (8 * res)
    dzdy = ((p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])) / (8 * res)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)
    zen, az = math.radians(90 - altitude), math.radians((360 - azimuth + 90) % 360)
    return np.clip(np.cos(zen) * np.cos(slope) + np.sin(zen) * np.sin(slope) * np.cos(az - aspect), 0, 1)


def utm_inverse_np(E, N):
    """Vectorised geo.utm_inverse for the whole output grid."""
    xi, eta = (N - geo.N0) / (geo.K0 * geo.A), (E - geo.E0) / (geo.K0 * geo.A)
    xi_ = xi - sum(b * np.sin(2 * j * xi) * np.cosh(2 * j * eta) for j, b in enumerate(geo.BETA, 1))
    eta_ = eta - sum(b * np.cos(2 * j * xi) * np.sinh(2 * j * eta) for j, b in enumerate(geo.BETA, 1))
    chi = np.arcsin(np.sin(xi_) / np.cosh(eta_))
    phi = chi + sum(d * np.sin(2 * j * chi) for j, d in enumerate(geo.DELTA, 1))
    return np.degrees(phi), geo.LON0 + np.degrees(np.arctan2(np.sinh(eta_), np.cos(xi_)))


# -- hydrology -----------------------------------------------------------
D8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def priority_flood(z):
    """Barnes et al. (2014) Priority-Flood with epsilon: fills pits so every
    cell drains to the edge, adding a tiny gradient across flats."""
    h, w = z.shape
    filled = z.copy()
    done = np.zeros(z.shape, bool)
    heap = []
    for r in range(h):
        for c in (0, w - 1):
            heapq.heappush(heap, (filled[r, c], r, c)); done[r, c] = True
    for c in range(1, w - 1):
        for r in (0, h - 1):
            heapq.heappush(heap, (filled[r, c], r, c)); done[r, c] = True
    eps = 1e-3
    while heap:
        e, r, c = heapq.heappop(heap)
        for dr, dc in D8:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and not done[rr, cc]:
                done[rr, cc] = True
                if filled[rr, cc] <= e:
                    filled[rr, cc] = e + eps
                heapq.heappush(heap, (filled[rr, cc], rr, cc))
    return filled


def flow(filled, res):
    """D8 receiver for each cell (or -1 at edges/outlets) and accumulation."""
    h, w = filled.shape
    p = np.pad(filled, 1, mode="constant", constant_values=np.inf)
    best = np.zeros(filled.shape)
    rec = -np.ones(filled.shape, dtype=np.int64)
    idx = np.arange(h * w).reshape(h, w)
    for dr, dc in D8:
        nb = p[1 + dr:1 + dr + h, 1 + dc:1 + dc + w]
        drop = (filled - nb) / (res * math.hypot(dr, dc))
        better = drop > best
        best = np.where(better, drop, best)
        tgt = np.roll(np.roll(idx, -dr, 0), -dc, 1)
        rec = np.where(better, tgt, rec)
    order = np.argsort(-filled, axis=None, kind="stable")
    acc = np.ones(h * w)
    rflat = rec.ravel()
    for i in order:
        j = rflat[i]
        if j >= 0:
            acc[j] += acc[i]
    return rflat, acc


def streams(rec, acc, shape, min_cells):
    """Trace stream lines from heads down to junctions; Strahler order."""
    h, w = shape
    is_stream = acc >= min_cells
    n_up = np.zeros(h * w, dtype=np.int32)
    for i in np.flatnonzero(is_stream):
        j = rec[i]
        if j >= 0 and is_stream[j]:
            n_up[j] += 1
    order = np.zeros(h * w, dtype=np.int16)
    up_orders: dict[int, list[int]] = {}
    heads = [i for i in np.flatnonzero(is_stream) if n_up[i] == 0]
    lines = []
    pending = list(heads)
    remaining = n_up.copy()
    while pending:
        i = pending.pop()
        ups = up_orders.get(i, [])
        o = max(ups) + (1 if ups.count(max(ups)) > 1 else 0) if ups else 1
        line = [i]
        j = rec[i]
        while j >= 0 and is_stream[j] and n_up[j] == 1:
            order[j] = o
            line.append(j)
            j = rec[j]
        order[i] = o
        if j >= 0 and is_stream[j]:
            line.append(j)
            up_orders.setdefault(j, []).append(o)
            remaining[j] -= 1
            if remaining[j] == 0:
                pending.append(j)
        lines.append((o, line))
    return [(o, [divmod(int(k), w) for k in line]) for o, line in lines]


# -- geometry helpers ----------------------------------------------------
def simplify(pts, tol):
    """Douglas-Peucker on a list of (x, y)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-12
        best, k = -1.0, -1
        for i in range(a + 1, b):
            x0, y0 = pts[i]
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / L
            if d > best:
                best, k = d, i
        if best > tol:
            keep[k] = True
            stack += [(a, k), (k, b)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_any(pts, tol):
    """Douglas-Peucker that also handles closed rings (first == last point):
    split at the vertex farthest from the start and simplify both halves."""
    if len(pts) > 3 and pts[0] == pts[-1]:
        x0, y0 = pts[0]
        k = max(range(len(pts)), key=lambda i: (pts[i][0] - x0) ** 2 + (pts[i][1] - y0) ** 2)
        return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)
    return simplify(pts, tol)


def packed(pts):
    """[x0, y0, dx1, dy1, ...] in whole decametres (10 m); the app unpacks."""
    out, px, py = [], 0, 0
    for x, y in pts:
        qx, qy = round(x / 10), round(y / 10)
        out += [qx - px, qy - py]
        px, py = qx, qy
    return out


def km(v):
    return round(v / 1000, 3)


def path_km(pts):
    return [[km(x), km(y)] for x, y in pts]


def point_in_ring(x, y, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def main():
    print("Census 2011 districts")
    for ext in ("shp", "shx", "dbf", "prj"):
        fetch(f"{CENSUS}.{ext}", CACHE / f"2011_Dist.{ext}")
    sf = shapefile.Reader(str(CACHE / "2011_Dist"))
    districts = []
    wokha = None
    for sr in sf.iterShapeRecords():
        rec = sr.record.as_dict()
        if rec["DISTRICT"] not in NEIGHBOURS:
            continue
        parts = list(sr.shape.parts) + [len(sr.shape.points)]
        rings = [sr.shape.points[a:b] for a, b in zip(parts, parts[1:])]
        districts.append({"name": rec["DISTRICT"], "state": rec["ST_NM"], "rings_ll": rings})
        if rec["DISTRICT"] == "Wokha":
            wokha = sr.shape
    lon0, lat0, lon1, lat1 = wokha.bbox
    bbox = (lon0 - MARGIN_DEG, lat0 - MARGIN_DEG, lon1 + MARGIN_DEG, lat1 + MARGIN_DEG)

    print("Elevation")
    dem, ox, oy = load_dem(bbox)
    corners = [geo.utm(la, lo) for la, lo in [(bbox[1], bbox[0]), (bbox[1], bbox[2]), (bbox[3], bbox[0]), (bbox[3], bbox[2])]]
    e0 = math.floor(min(c[0] for c in corners) / 1000) * 1000
    e1 = math.ceil(max(c[0] for c in corners) / 1000) * 1000
    n0 = math.floor(min(c[1] for c in corners) / 1000) * 1000
    n1 = math.ceil(max(c[1] for c in corners) / 1000) * 1000
    cols, rows = int((e1 - e0) / RES), int((n1 - n0) / RES)
    E, N = np.meshgrid(e0 + (np.arange(cols) + 0.5) * RES, n1 - (np.arange(rows) + 0.5) * RES)
    lat, lon = utm_inverse_np(E, N)
    z = sample(dem, ox, oy, lat, lon)
    print(f"  grid {cols} x {rows} at {RES:g} m, elevation {z.min():.0f}–{z.max():.0f} m")

    shade = hillshade(z, RES)
    # Grey relief where flat ground = mid-grey (128): the app blends it with
    # soft-light, so shadows darken and lit slopes lighten in every theme.
    flat = math.cos(math.radians(45))
    grey = np.where(shade < flat, 128 * shade / flat, 128 + 127 * (shade - flat) / (1 - flat))
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(grey, 0, 255).astype(np.uint8), "L").save(OUT / "terrain.webp", "WEBP", quality=70, method=6)

    print("Contours")
    gen = contourpy.contour_generator(z=z[::-1], x=E[0], y=N[::-1, 0], name="serial")
    contours = []
    for level in range(int(z.min() // CONTOUR_STEP + 1) * CONTOUR_STEP, int(z.max()) + 1, CONTOUR_STEP):
        paths = []
        for line in gen.lines(level):
            pts = [tuple(map(float, p)) for p in line]
            length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            if length >= MIN_CONTOUR_M:  # drops SRTM noise rings on the plains
                paths.append(packed(simplify_any(pts, RES)))
        if paths:
            contours.append({"elev": level, "index": level % 500 == 0, "paths": paths})

    print("Hydrology (priority-flood, D8)")
    filled = priority_flood(z)
    rec, acc = flow(filled, RES)
    min_cells = STREAM_MIN_KM2 * 1e6 / RES ** 2
    lines = streams(rec, acc, z.shape, min_cells)
    stream_out = []
    for o, cells in lines:
        pts = [(e0 + (c + 0.5) * RES, n1 - (r + 0.5) * RES) for r, c in cells]
        pts = simplify(pts, RES * 0.7)
        if len(pts) >= 2:
            stream_out.append({"order": int(o), "path": packed(pts)})
    print(f"  {len(stream_out)} stream segments, max Strahler order {max(s['order'] for s in stream_out)}")

    print("Boundaries")
    dist_out = []
    for d in districts:
        rings = []
        for ring in d["rings_ll"]:
            xy = [geo.utm(la, lo) for lo, la in ring]
            rings.append(packed(simplify_any(xy, 40)))
        dist_out.append({"name": d["name"], "state": d["state"], "rings": rings})
        if d["name"] == "Wokha":
            wokha_rings = [[geo.utm(la, lo) for lo, la in r] for r in d["rings_ll"]]

    # Highest point inside the district (spot height)
    inside = np.zeros(z.shape, bool)
    step = 10
    for r in range(0, rows, step):
        for c in range(0, cols, step):
            x, y = e0 + (c + 0.5) * RES, n1 - (r + 0.5) * RES
            if any(point_in_ring(x, y, ring) for ring in wokha_rings):
                inside[r:r + step, c:c + step] = True
    zr = np.where(inside, z, -1)
    r, c = np.unravel_index(np.argmax(zr), z.shape)
    peak = {"e": km(e0 + (c + 0.5) * RES), "n": km(n1 - (r + 0.5) * RES), "elev": int(round(z[r, c]))}
    plat, plon = geo.utm_inverse(peak["e"] * 1000, peak["n"] * 1000)
    # The district's highest DEM cell lies on Mount Tiyi, the peak just east
    # of Wokha town (usually quoted as about 1,969 m; SRTM vertical error is
    # roughly ±16 m).
    peak.update(lat=round(plat, 5), lng=round(plon, 5), name="Mount Tiyi")

    layers = {
        "crs": "EPSG:32646 (WGS 84 / UTM zone 46N)",
        "units": "paths: [x0, y0, dx, dy, ...] in decametres (10 m) of UTM easting/northing; extents in km",
        "extent": [km(e0), km(n0), km(e1), km(n1)],
        "terrain": {"href": "map/terrain.webp", "extent": [km(e0), km(n0), km(e1), km(n1)], "resolution_m": RES},
        "elevation_range": [int(z.min()), int(z.max())],
        "contour_step": CONTOUR_STEP,
        "contours": contours,
        "streams": stream_out,
        "districts": dist_out,
        "peaks": [peak],
        "attribution": [
            "Elevation: NASA SRTM via AWS Terrain Tiles (public domain)",
            "District boundaries: Census of India 2011, DataMeet (CC BY 2.5 IN)",
            "Streams derived from elevation (catchment > 5 km²)",
        ],
    }
    (OUT / "layers.json").write_text(json.dumps(layers, separators=(",", ":")))

    print("Village check")
    from hatialert import domain
    report = []
    for v in domain.VILLAGES:
        x, y = geo.utm(v["lat"], v["lng"])
        ins = any(point_in_ring(x, y, ring) for ring in wokha_rings)
        el = float(sample(dem, ox, oy, np.array([v["lat"]]), np.array([v["lng"]]))[0])
        report.append((v["name"], ins, round(el)))
        print(f"  {v['name']:<12} in Wokha district: {'yes' if ins else 'NO '}  ground {el:5.0f} m")
    print(f"Wrote {OUT / 'terrain.webp'} ({(OUT / 'terrain.webp').stat().st_size // 1024} KB) and layers.json "
          f"({(OUT / 'layers.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
