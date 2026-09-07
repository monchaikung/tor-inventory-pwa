from __future__ import annotations

from uk_car_advisor.models import VehicleResult

_ATTRIBUTES: list[tuple[str, str]] = [
    ("Price", "price"),
    ("Year", "year"),
    ("Mileage", "mileage"),
    ("Trim", "trim"),
    ("Seller", "seller"),
    ("Distance (miles)", "distance"),
    ("ULEZ", "ulez"),
    ("MOT", "mot"),
    ("Tax", "tax"),
    ("Annual tax (£)", "ved"),
    ("MPG combined", "mpg"),
    ("Insurance group", "insurance"),
    ("Fuel", "fuel"),
    ("Key features", "features"),
    ("Dealer / location", "dealer"),
    ("Postcode", "postcode"),
    ("Listing", "url"),
]


def _fmt_bool(value: bool | None) -> str:
    if value is True:
        return "Yes"
    if value is False:
        return "No"
    return "—"


def _cell(vehicle: VehicleResult, key: str) -> str:
    spec = vehicle.specifications
    mapping = {
        "price": f"£{vehicle.price_gbp:,}" if vehicle.price_gbp is not None else "—",
        "year": str(vehicle.year) if vehicle.year else "—",
        "mileage": f"{vehicle.mileage:,}" if vehicle.mileage is not None else "—",
        "trim": vehicle.trim or "—",
        "seller": vehicle.seller_type.title(),
        "distance": (
            f"{vehicle.location.distance_miles}"
            if vehicle.location.distance_miles is not None
            else "—"
        ),
        "ulez": _fmt_bool(spec.ulez_compliant),
        "mot": spec.mot_status or "—",
        "tax": spec.tax_status or "—",
        "ved": str(spec.annual_tax_gbp) if spec.annual_tax_gbp is not None else "—",
        "mpg": str(spec.mpg_combined) if spec.mpg_combined is not None else "—",
        "insurance": spec.insurance_group or "—",
        "fuel": spec.fuel_type or "—",
        "features": ", ".join(vehicle.key_features) or "—",
        "dealer": vehicle.location.dealer_name,
        "postcode": vehicle.location.postcode or "—",
        "url": vehicle.listing_url,
    }
    return mapping[key]


def comparison_table(vehicles: list[VehicleResult]) -> dict[str, dict[str, str]]:
    """Attribute -> {car label: value} for a side-by-side table."""
    columns: dict[str, dict[str, str]] = {}
    used_labels: dict[str, int] = {}
    for vehicle in vehicles:
        label = vehicle.label
        if label in used_labels:
            used_labels[label] += 1
            label = f"{label} ({used_labels[label]})"
        else:
            used_labels[label] = 1
        columns[label] = {title: _cell(vehicle, key) for title, key in _ATTRIBUTES}
    # pivot to row-oriented dict for DataFrame
    rows: dict[str, dict[str, str]] = {}
    for title, _key in _ATTRIBUTES:
        rows[title] = {label: columns[label][title] for label in columns}
    return rows
