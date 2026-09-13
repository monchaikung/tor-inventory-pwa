from __future__ import annotations

import os
import re
from typing import Any

import httpx

from uk_car_advisor.models import Specifications, VehicleResult

VES_URL = "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles"


class DvlaError(RuntimeError):
    """DVLA VES request failed."""


def get_api_key() -> str | None:
    key = os.environ.get("DVLA_API_KEY", "").strip()
    return key or None


def parse_euro_status(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"(\d+)", str(value))
    return int(match.group(1)) if match else None


def ulez_compliant(fuel_type: str | None, euro_status: str | None) -> bool | None:
    """TfL ULEZ: petrol Euro 4+, diesel Euro 6+, most BEVs compliant."""
    if not fuel_type:
        return None
    fuel = fuel_type.lower()
    if "electric" in fuel and "hybrid" not in fuel:
        return True
    euro_n = parse_euro_status(euro_status)
    diesel = "diesel" in fuel
    if "hybrid" in fuel and not diesel:
        if euro_n is None:
            return True
        return euro_n >= 4
    if euro_n is None:
        return None
    if diesel:
        return euro_n >= 6
    return euro_n >= 4


def fetch_vehicle(
    vrm: str,
    *,
    api_key: str | None = None,
    client: httpx.Client | None = None,
    timeout: float = 10.0,
) -> dict[str, Any]:
    key = api_key if api_key is not None else get_api_key()
    if not key:
        raise DvlaError("DVLA_API_KEY is not set")
    compact = re.sub(r"\s+", "", vrm or "").upper()
    if not compact:
        raise DvlaError("VRM is empty")

    own_client = client is None
    http = client or httpx.Client(timeout=timeout)
    try:
        response = http.post(
            VES_URL,
            headers={"x-api-key": key, "Content-Type": "application/json"},
            json={"registrationNumber": compact},
        )
        if response.status_code == 404:
            raise DvlaError(f"VRM not found: {compact}")
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        raise DvlaError(f"DVLA VES failed for {compact}: {exc}") from exc
    finally:
        if own_client:
            http.close()


def apply_ves_payload(vehicle: VehicleResult, payload: dict[str, Any]) -> VehicleResult:
    spec = vehicle.specifications
    fuel = payload.get("fuelType") or spec.fuel_type
    euro = payload.get("euroStatus") or spec.euro_status
    spec.fuel_type = fuel
    spec.euro_status = euro
    spec.mot_status = payload.get("motStatus") or spec.mot_status
    spec.tax_status = payload.get("taxStatus") or spec.tax_status
    derived = ulez_compliant(fuel, euro)
    if derived is not None:
        spec.ulez_compliant = derived
    if not vehicle.make and payload.get("make"):
        vehicle.make = str(payload["make"]).title()
    year = payload.get("yearOfManufacture")
    if vehicle.year is None and year:
        try:
            vehicle.year = int(year)
        except (TypeError, ValueError):
            pass
    return vehicle


def enrich_vehicle(vehicle: VehicleResult, *, api_key: str | None = None) -> VehicleResult:
    key = api_key if api_key is not None else get_api_key()
    if not key or not vehicle.vrm:
        return vehicle
    payload = fetch_vehicle(vehicle.vrm, api_key=key)
    return apply_ves_payload(vehicle, payload)


def enrich_vehicles(
    vehicles: list[VehicleResult],
    *,
    api_key: str | None = None,
) -> tuple[list[VehicleResult], list[str]]:
    key = api_key if api_key is not None else get_api_key()
    errors: list[str] = []
    if not key:
        return vehicles, errors
    for vehicle in vehicles:
        if not vehicle.vrm:
            continue
        try:
            enrich_vehicle(vehicle, api_key=key)
        except DvlaError as exc:
            errors.append(str(exc))
    return vehicles, errors
