from __future__ import annotations

from dataclasses import dataclass

from uk_car_advisor.db import CarDatabase
from uk_car_advisor.distance import haversine_miles
from uk_car_advisor.models import Coordinates, Dealer, VehicleResult
from uk_car_advisor.postcode import PostcodeError, lookup_postcode


@dataclass
class DealerDossier:
    dealer: Dealer
    distance_miles: float | None
    other_stock: list[VehicleResult]
    is_private: bool = False
    private_note: str | None = None


def dealer_from_vehicle(vehicle: VehicleResult, *, source: str | None = None) -> Dealer | None:
    if vehicle.seller_type != "dealer":
        return None
    loc = vehicle.location
    if not loc.dealer_name or loc.dealer_name in {"Unknown", "Trade seller", "Motors.co.uk seller", "Carwow partner dealer"}:
        name = loc.dealer_name or "Trade seller"
    else:
        name = loc.dealer_name
    if not loc.postcode and not name:
        return None
    return Dealer(
        name=name,
        postcode=loc.postcode or "",
        address=loc.address,
        phone=loc.phone,
        website=loc.website,
        stock_url=loc.stock_url,
        source=source or vehicle.source,
    )


def persist_dealer(db: CarDatabase, vehicle: VehicleResult) -> int | None:
    dealer = dealer_from_vehicle(vehicle)
    if dealer is None:
        return None
    dealer_id = db.upsert_dealer(dealer)
    vehicle.dealer_id = dealer_id
    return dealer_id


def enrich_dealer_location(dealer: Dealer) -> Dealer:
    if not dealer.postcode:
        return dealer
    if dealer.latitude is not None and dealer.longitude is not None and dealer.admin_district:
        return dealer
    try:
        coords = lookup_postcode(dealer.postcode)
    except PostcodeError:
        return dealer
    dealer.latitude = coords.latitude
    dealer.longitude = coords.longitude
    dealer.admin_district = dealer.admin_district or coords.admin_district
    return dealer


def other_stock(
    db: CarDatabase,
    vehicle: VehicleResult,
) -> list[VehicleResult]:
    if vehicle.dealer_id:
        stock = db.vehicles_for_dealer(vehicle.dealer_id, exclude_vehicle_id=vehicle.id)
        if stock:
            return stock
    return db.vehicles_for_dealer_name(
        vehicle.location.dealer_name,
        vehicle.location.postcode,
        exclude_vehicle_id=vehicle.id,
    )


def build_dossier(
    db: CarDatabase,
    vehicle: VehicleResult,
    user_coords: Coordinates | None = None,
) -> DealerDossier:
    if vehicle.seller_type != "dealer":
        distance = vehicle.location.distance_miles
        return DealerDossier(
            dealer=Dealer(
                name="Private seller",
                postcode=vehicle.location.postcode,
                address=vehicle.location.address,
            ),
            distance_miles=distance,
            other_stock=[],
            is_private=True,
            private_note="Private sale — no dealer stock list. Confirm the seller in person and use a safe meeting place.",
        )

    dealer = None
    if vehicle.dealer_id:
        dealer = db.get_dealer(vehicle.dealer_id)
    if dealer is None:
        dealer = db.find_dealer(vehicle.location.dealer_name, vehicle.location.postcode)
    if dealer is None:
        dealer = dealer_from_vehicle(vehicle) or Dealer(
            name=vehicle.location.dealer_name,
            postcode=vehicle.location.postcode,
            address=vehicle.location.address,
            phone=vehicle.location.phone,
            website=vehicle.location.website,
            stock_url=vehicle.location.stock_url,
        )
        dealer = enrich_dealer_location(dealer)
        dealer.id = db.upsert_dealer(dealer)

    distance = vehicle.location.distance_miles
    if (
        distance is None
        and user_coords
        and dealer.latitude is not None
        and dealer.longitude is not None
    ):
        distance = haversine_miles(
            user_coords.latitude,
            user_coords.longitude,
            dealer.latitude,
            dealer.longitude,
        )
    return DealerDossier(
        dealer=dealer,
        distance_miles=distance,
        other_stock=other_stock(db, vehicle),
        is_private=False,
    )
