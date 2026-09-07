from __future__ import annotations

import re

import httpx

from uk_car_advisor.models import Coordinates

# Outward code + inward code, optional space. Accepts M1 1AE, M11AE, EC1A 1BB.
UK_POSTCODE_RE = re.compile(
    r"^(GIR\s*0AA|"
    r"[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2})$",
    re.IGNORECASE,
)

POSTCODES_IO_URL = "https://api.postcodes.io/postcodes/{postcode}"


class PostcodeError(ValueError):
    """Invalid or unresolved UK postcode."""


def normalize_postcode(postcode: str) -> str:
    compact = re.sub(r"\s+", "", postcode or "").upper()
    if len(compact) < 5:
        return compact
    return f"{compact[:-3]} {compact[-3:]}"


def is_valid_uk_postcode(postcode: str) -> bool:
    compact = re.sub(r"\s+", "", postcode or "")
    return bool(UK_POSTCODE_RE.match(compact))


def lookup_postcode(
    postcode: str,
    *,
    client: httpx.Client | None = None,
    timeout: float = 10.0,
) -> Coordinates:
    if not is_valid_uk_postcode(postcode):
        raise PostcodeError(f"Not a valid UK postcode: {postcode!r}")
    normalised = normalize_postcode(postcode)
    path = POSTCODES_IO_URL.format(postcode=normalised.replace(" ", ""))
    own_client = client is None
    http = client or httpx.Client(timeout=timeout)
    try:
        response = http.get(path)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise PostcodeError(f"Postcodes.io lookup failed for {normalised}: {exc}") from exc
    finally:
        if own_client:
            http.close()

    if payload.get("status") != 200 or not payload.get("result"):
        raise PostcodeError(f"Postcodes.io did not recognise {normalised}")

    result = payload["result"]
    return Coordinates(
        latitude=float(result["latitude"]),
        longitude=float(result["longitude"]),
        postcode=result.get("postcode", normalised),
        admin_district=result.get("admin_district"),
        region=result.get("region"),
    )
