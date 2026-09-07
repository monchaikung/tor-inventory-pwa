from __future__ import annotations

from uk_car_advisor.db import CarDatabase
from uk_car_advisor.dealers import persist_dealer
from uk_car_advisor.distance import haversine_miles
from uk_car_advisor.dvla import enrich_vehicles
from uk_car_advisor.models import Coordinates, SearchOutcome, SearchParams, VehicleResult
from uk_car_advisor.postcode import PostcodeError, lookup_postcode, normalize_postcode
from uk_car_advisor.scrapers.autotrader import AutoTraderScraper
from uk_car_advisor.scrapers.carwow import CarwowScraper
from uk_car_advisor.scrapers.demo import DEALER_COORDS, DemoScraper
from uk_car_advisor.scrapers.motors import MotorsScraper

SCRAPERS = {
    "demo": DemoScraper(),
    "autotrader": AutoTraderScraper(),
    "motors": MotorsScraper(),
    "carwow": CarwowScraper(),
}

# Fallback only for demo searches if Postcodes.io is unreachable.
DEMO_USER_FALLBACK = Coordinates(
    latitude=53.4808,
    longitude=-2.2369,
    postcode="M1 1AE",
    admin_district="Manchester",
    region="North West",
)


def resolve_user_postcode(postcode: str, *, allow_demo_fallback: bool) -> Coordinates:
    try:
        return lookup_postcode(postcode)
    except PostcodeError:
        if allow_demo_fallback:
            coords = Coordinates(
                latitude=DEMO_USER_FALLBACK.latitude,
                longitude=DEMO_USER_FALLBACK.longitude,
                postcode=normalize_postcode(postcode),
                admin_district=DEMO_USER_FALLBACK.admin_district,
                region=DEMO_USER_FALLBACK.region,
            )
            return coords
        raise


def apply_distances(vehicles: list[VehicleResult], user: Coordinates) -> None:
    for vehicle in vehicles:
        if vehicle.location.distance_miles is not None:
            continue
        pc = vehicle.location.postcode
        baked = DEALER_COORDS.get(pc)
        if baked:
            vehicle.location.distance_miles = haversine_miles(
                user.latitude, user.longitude, baked[0], baked[1]
            )
            continue
        if not pc:
            continue
        try:
            dealer_coords = lookup_postcode(pc)
        except PostcodeError:
            continue
        vehicle.location.distance_miles = haversine_miles(
            user.latitude,
            user.longitude,
            dealer_coords.latitude,
            dealer_coords.longitude,
        )


def _within_radius(vehicle: VehicleResult, radius_miles: int) -> bool:
    if vehicle.location.distance_miles is None:
        return True
    return vehicle.location.distance_miles <= radius_miles + 0.05


def persist_results(
    db: CarDatabase,
    params: SearchParams,
    vehicles: list[VehicleResult],
) -> tuple[int, list[VehicleResult]]:
    search_id = db.insert_search(params)
    stored: list[VehicleResult] = []
    for vehicle in vehicles:
        vehicle.search_id = search_id
        persist_dealer(db, vehicle)
        vehicle.id = db.insert_vehicle(vehicle)
        stored.append(vehicle)
    return search_id, db.list_vehicles(search_id)


def enrich_live_dealer_stock(
    db: CarDatabase,
    vehicles: list[VehicleResult],
    *,
    headed: bool,
    sources: list[str],
) -> list[str]:
    errors: list[str] = []
    if "demo" in sources and len(sources) == 1:
        return errors
    seen: set[str] = set()
    enriched = 0
    for vehicle in vehicles:
        if vehicle.seller_type != "dealer" or not vehicle.location.stock_url:
            continue
        url = vehicle.location.stock_url
        if url in seen:
            continue
        seen.add(url)
        scraper = SCRAPERS.get(vehicle.source) or SCRAPERS["autotrader"]
        try:
            extras = scraper.enrich_dealer_stock(url, headed=headed)
        except Exception as exc:  # noqa: BLE001 — live portals fail often
            errors.append(f"{vehicle.source} dealer stock failed: {exc}")
            continue
        for extra in extras:
            extra.search_id = vehicle.search_id
            extra.seller_type = "dealer"
            extra.location.dealer_name = extra.location.dealer_name or vehicle.location.dealer_name
            extra.location.postcode = extra.location.postcode or vehicle.location.postcode
            persist_dealer(db, extra)
            db.insert_vehicle(extra)
        enriched += 1
        if enriched >= 2:
            break
    return errors


def run_search(
    params: SearchParams,
    *,
    sources: list[str],
    headed: bool = False,
    db: CarDatabase | None = None,
    dvla_enrich: bool = True,
) -> SearchOutcome:
    db = db or CarDatabase()
    params.postcode = normalize_postcode(params.postcode)
    demo_only = sources == ["demo"]
    user_coords = resolve_user_postcode(params.postcode, allow_demo_fallback=demo_only)

    collected: list[VehicleResult] = []
    errors: list[str] = []
    for name in sources:
        scraper = SCRAPERS.get(name)
        if scraper is None:
            errors.append(f"Unknown source: {name}")
            continue
        try:
            batch = scraper.search(params, headed=headed)
            collected.extend(batch)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}: {exc}")

    apply_distances(collected, user_coords)
    collected = [v for v in collected if _within_radius(v, params.radius_miles)]

    if dvla_enrich:
        collected, dvla_errors = enrich_vehicles(collected)
        errors.extend(dvla_errors)

    search_id, stored = persist_results(db, params, collected)
    errors.extend(enrich_live_dealer_stock(db, stored, headed=headed, sources=sources))
    stored = db.list_vehicles(search_id)
    return SearchOutcome(
        params=params,
        search_id=search_id,
        vehicles=stored,
        errors=errors,
        user_coords=user_coords,
    )
