from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

SellerType = Literal["dealer", "private"]


@dataclass
class SearchParams:
    postcode: str
    radius_miles: int
    budget_max: int
    fuel_type: list[str] = field(default_factory=list)
    features: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Dealer:
    name: str
    postcode: str
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    stock_url: str | None = None
    source: str = "demo"
    admin_district: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    id: int | None = None


@dataclass
class Location:
    dealer_name: str
    postcode: str
    distance_miles: float | None = None
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    stock_url: str | None = None


@dataclass
class Specifications:
    ulez_compliant: bool | None = None
    annual_tax_gbp: int | None = None
    mpg_combined: float | None = None
    insurance_group: str | None = None
    mot_status: str | None = None
    tax_status: str | None = None
    euro_status: str | None = None
    fuel_type: str | None = None


@dataclass
class VehicleResult:
    make: str
    model: str
    listing_url: str
    price_gbp: int | None = None
    year: int | None = None
    mileage: int | None = None
    trim: str | None = None
    vrm: str | None = None
    seller_type: SellerType = "dealer"
    location: Location = field(
        default_factory=lambda: Location(dealer_name="Unknown", postcode="")
    )
    specifications: Specifications = field(default_factory=Specifications)
    key_features: list[str] = field(default_factory=list)
    dealer_id: int | None = None
    source: str = "demo"
    id: int | None = None
    search_id: int | None = None

    @property
    def label(self) -> str:
        year = f"{self.year} " if self.year else ""
        trim = f" {self.trim}" if self.trim else ""
        return f"{year}{self.make} {self.model}{trim}".strip()

    def to_srd_dict(self) -> dict[str, Any]:
        return {
            "vrm": self.vrm,
            "make": self.make,
            "model": self.model,
            "trim": self.trim,
            "year": self.year,
            "mileage": self.mileage,
            "price_gbp": self.price_gbp,
            "seller_type": self.seller_type,
            "location": {
                "dealer_name": self.location.dealer_name,
                "postcode": self.location.postcode,
                "distance_miles": self.location.distance_miles,
                "address": self.location.address,
                "phone": self.location.phone,
                "website": self.location.website,
            },
            "specifications": asdict(self.specifications),
            "key_features": self.key_features,
            "listing_url": self.listing_url,
        }


@dataclass
class Coordinates:
    latitude: float
    longitude: float
    postcode: str
    admin_district: str | None = None
    region: str | None = None


@dataclass
class SearchOutcome:
    params: SearchParams
    search_id: int
    vehicles: list[VehicleResult]
    errors: list[str] = field(default_factory=list)
    user_coords: Coordinates | None = None
