from __future__ import annotations

import math

EARTH_RADIUS_MILES = 3958.8


def haversine_miles(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """Straight-line (great-circle) distance in miles."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    miles = 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))
    return round(miles, 1)
