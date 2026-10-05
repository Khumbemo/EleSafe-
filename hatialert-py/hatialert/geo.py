"""WGS 84 ⇄ UTM zone 46N (EPSG:32646), the grid used by the map.

Krüger series to third order in n (Karney 2011), accurate to well under a
millimetre inside the zone. web/app.js carries the same forward formula.
"""

from __future__ import annotations

import math

A_WGS84 = 6378137.0
F_WGS84 = 1 / 298.257223563
K0 = 0.9996
LON0 = 93.0  # zone 46 central meridian
E0, N0 = 500_000.0, 0.0

_n = F_WGS84 / (2 - F_WGS84)
A = A_WGS84 / (1 + _n) * (1 + _n**2 / 4 + _n**4 / 64)
ALPHA = (_n / 2 - 2 * _n**2 / 3 + 5 * _n**3 / 16, 13 * _n**2 / 48 - 3 * _n**3 / 5, 61 * _n**3 / 240)
BETA = (_n / 2 - 2 * _n**2 / 3 + 37 * _n**3 / 96, _n**2 / 48 + _n**3 / 15, 17 * _n**3 / 480)
DELTA = (2 * _n - 2 * _n**2 / 3 - 2 * _n**3, 7 * _n**2 / 3 - 8 * _n**3 / 5, 56 * _n**3 / 15)
_C = 2 * math.sqrt(_n) / (1 + _n)


def utm(lat: float, lon: float) -> tuple[float, float]:
    """(easting, northing) in metres."""
    phi, dl = math.radians(lat), math.radians(lon - LON0)
    t = math.sinh(math.atanh(math.sin(phi)) - _C * math.atanh(_C * math.sin(phi)))
    xi, eta = math.atan2(t, math.cos(dl)), math.atanh(math.sin(dl) / math.sqrt(1 + t * t))
    e = eta + sum(a * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j, a in enumerate(ALPHA, 1))
    n = xi + sum(a * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j, a in enumerate(ALPHA, 1))
    return E0 + K0 * A * e, N0 + K0 * A * n


def utm_inverse(easting: float, northing: float) -> tuple[float, float]:
    """(lat, lon) in degrees."""
    xi, eta = (northing - N0) / (K0 * A), (easting - E0) / (K0 * A)
    xi_ = xi - sum(b * math.sin(2 * j * xi) * math.cosh(2 * j * eta) for j, b in enumerate(BETA, 1))
    eta_ = eta - sum(b * math.cos(2 * j * xi) * math.sinh(2 * j * eta) for j, b in enumerate(BETA, 1))
    chi = math.asin(math.sin(xi_) / math.cosh(eta_))
    phi = chi + sum(d * math.sin(2 * j * chi) for j, d in enumerate(DELTA, 1))
    return math.degrees(phi), LON0 + math.degrees(math.atan2(math.sinh(eta_), math.cos(xi_)))
