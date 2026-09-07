from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from importlib.resources import files
from typing import Any

from uk_car_advisor.db import CarDatabase
from uk_car_advisor.models import VehicleResult

GENERIC_FUEL: dict[str, dict[str, Any]] = {
    "petrol": {
        "service_interval": "Typically 12 months / 10,000 miles",
        "service_cost_band": "£140–£300 independent",
        "running_notes": "Usually simpler and cheaper than diesel for mixed/urban UK use.",
        "common_issues": [
            "Timing belt or wet belt due dates on smaller turbo petrols",
            "Carbon build-up on some direct-injection engines",
            "Turbo pipes and ignition coils on higher-mileage cars",
        ],
        "viewing_checks": [
            "Cold start without warning lights",
            "Smooth idle and no sweet coolant smell",
            "Service stamps matching the mileage",
        ],
    },
    "diesel": {
        "service_interval": "Typically 12 months / 12,000 miles",
        "service_cost_band": "£180–£350 independent",
        "running_notes": "Best if you regularly drive longer dual-carriageway trips. Short hops clog DPFs.",
        "common_issues": [
            "DPF / EGR / AdBlue faults on urban-only cars",
            "Dual-mass flywheel judder on manuals",
            "Turbo actuator and glow-plug issues",
        ],
        "viewing_checks": [
            "No DPF or AdBlue warnings after a good run",
            "Clutch bite should be clean (manuals)",
            "Evidence of motorway use in the history",
        ],
    },
    "hybrid": {
        "service_interval": "Typically 12 months / 10,000 miles plus a hybrid health check",
        "service_cost_band": "£160–£320 plus occasional 12V battery",
        "running_notes": "Excellent around town. Confirm the hybrid system is healthy rather than chasing a low price.",
        "common_issues": [
            "12V auxiliary battery failure",
            "Brake rust from regenerative braking",
            "Inverter coolant service sometimes skipped",
        ],
        "viewing_checks": [
            "Ready / EV / charging screens with no triangles",
            "Quiet transition between engine and electric drive",
            "Main-dealer or specialist hybrid history",
        ],
    },
    "electric": {
        "service_interval": "Typically 12 months; fewer fluids than ICE",
        "service_cost_band": "£120–£250 plus tyres",
        "running_notes": "ULEZ-friendly. Range, charger type and remaining battery warranty matter more than MPG.",
        "common_issues": [
            "Tyre wear from instant torque",
            "12V battery draining if left unused",
            "On-board charger or CCS socket faults (uncommon)",
        ],
        "viewing_checks": [
            "State of health / range after a full charge if shown",
            "Remaining traction-battery warranty",
            "All charging ports and the heat pump / climate system",
        ],
    },
}


def _fuel_bucket(fuel: str | None) -> str:
    if not fuel:
        return "petrol"
    value = fuel.lower()
    if "electric" in value and "hybrid" not in value:
        return "electric"
    if "hybrid" in value:
        return "hybrid"
    if "diesel" in value:
        return "diesel"
    return "petrol"


@lru_cache(maxsize=1)
def load_model_advice() -> dict[str, Any]:
    packaged = files("uk_car_advisor").joinpath("data/model_advice.json")
    return json.loads(packaged.read_text(encoding="utf-8"))


def advice_key(make: str, model: str) -> str:
    return f"{make} {model}".strip().lower()


def lookup_model_entry(make: str, model: str) -> dict[str, Any] | None:
    data = load_model_advice()
    entry = data.get(advice_key(make, model))
    if entry:
        return entry
    make_l = make.lower()
    model_l = model.lower()
    for key, value in data.items():
        if key.startswith(make_l) and model_l in key:
            return value
    return None


def price_position(price: int | None, average: int | None) -> str:
    if price is None or not average:
        return "unknown"
    ratio = price / average
    if ratio < 0.92:
        return "cheaper than average"
    if ratio > 1.08:
        return "asking high"
    return "typical"


@dataclass
class ModelAdvice:
    make: str
    model: str
    has_curated: bool
    years: str | None
    service_interval: str
    service_cost_band: str
    running_notes: str
    common_issues: list[str]
    viewing_checks: list[str]
    stats: dict[str, Any]
    position: str
    selected_price: int | None
    fallback_note: str | None = None
    running_costs: dict[str, Any] = field(default_factory=dict)


def advise_model(
    vehicle: VehicleResult,
    db: CarDatabase,
    *,
    search_id: int | None = None,
) -> ModelAdvice:
    stats = db.price_stats(vehicle.make, vehicle.model, search_id=search_id)
    entry = lookup_model_entry(vehicle.make, vehicle.model)
    generic = GENERIC_FUEL[_fuel_bucket(vehicle.specifications.fuel_type)]
    has_curated = entry is not None
    source = entry or generic
    fallback = None
    if not has_curated:
        fallback = (
            f"No model-specific file for {vehicle.make} {vehicle.model}. "
            "Showing generic notes for this fuel type."
        )
    spec = vehicle.specifications
    return ModelAdvice(
        make=vehicle.make,
        model=vehicle.model,
        has_curated=has_curated,
        years=source.get("years") if has_curated else None,
        service_interval=source["service_interval"],
        service_cost_band=source["service_cost_band"],
        running_notes=source["running_notes"],
        common_issues=list(source["common_issues"]),
        viewing_checks=list(source["viewing_checks"]),
        stats=stats,
        position=price_position(vehicle.price_gbp, stats.get("average")),
        selected_price=vehicle.price_gbp,
        fallback_note=fallback,
        running_costs={
            "annual_tax_gbp": spec.annual_tax_gbp,
            "ulez_compliant": spec.ulez_compliant,
            "mpg_combined": spec.mpg_combined,
            "insurance_group": spec.insurance_group,
            "mot_status": spec.mot_status,
            "tax_status": spec.tax_status,
        },
    )


def advise_make_model(
    make: str,
    model: str,
    db: CarDatabase,
    *,
    search_id: int | None = None,
    fuel_type: str | None = None,
    selected_price: int | None = None,
) -> ModelAdvice:
    dummy = VehicleResult(
        make=make,
        model=model,
        listing_url="about:blank",
        price_gbp=selected_price,
    )
    dummy.specifications.fuel_type = fuel_type
    return advise_model(dummy, db, search_id=search_id)
