from __future__ import annotations

from dataclasses import replace

from uk_car_advisor.models import (
    Dealer,
    Location,
    SearchParams,
    Specifications,
    VehicleResult,
)
from uk_car_advisor.scrapers.base import Scraper

# Baked coordinates so demo search still computes distance if Postcodes.io is down.
DEALER_COORDS: dict[str, tuple[float, float]] = {
    "M4 4BF": (53.4872, -2.2301),
    "SK1 1AA": (53.4085, -2.1619),
    "M20 6PF": (53.4174, -2.2312),
}


def _dealer_manchester() -> Dealer:
    return Dealer(
        name="Manchester Autos",
        postcode="M4 4BF",
        address="12 Great Ancoats Street, Manchester M4 4BF",
        phone="0161 555 0142",
        website="https://www.manchesterautos.example",
        stock_url="https://www.autotrader.co.uk/car-search?onesearchad=Used&postcode=M44BF",
        source="demo",
        admin_district="Manchester",
        latitude=53.4872,
        longitude=-2.2301,
    )


def _dealer_stockport() -> Dealer:
    return Dealer(
        name="Stockport Motor Company",
        postcode="SK1 1AA",
        address="20 Wellington Road South, Stockport SK1 1AA",
        phone="0161 555 0288",
        website="https://www.stockportmotorco.example",
        stock_url="https://www.autotrader.co.uk/car-search?onesearchad=Used&postcode=SK11AA",
        source="demo",
        admin_district="Stockport",
        latitude=53.4085,
        longitude=-2.1619,
    )


def demo_dealers() -> list[Dealer]:
    return [_dealer_manchester(), _dealer_stockport()]


def _car(
    *,
    make: str,
    model: str,
    trim: str,
    year: int,
    mileage: int,
    price: int,
    vrm: str,
    dealer: Dealer | None,
    seller_type: str,
    fuel: str,
    mpg: float,
    tax: int,
    insurance: str,
    ulez: bool,
    mot: str,
    euro: str,
    features: list[str],
    url: str,
    private_postcode: str | None = None,
) -> VehicleResult:
    if dealer:
        loc = Location(
            dealer_name=dealer.name,
            postcode=dealer.postcode,
            address=dealer.address,
            phone=dealer.phone,
            website=dealer.website,
            stock_url=dealer.stock_url,
        )
    else:
        loc = Location(
            dealer_name="Private seller",
            postcode=private_postcode or "M20 6PF",
            address="Withington, Manchester",
        )
    return VehicleResult(
        make=make,
        model=model,
        trim=trim,
        year=year,
        mileage=mileage,
        price_gbp=price,
        vrm=vrm,
        seller_type=seller_type,  # type: ignore[arg-type]
        listing_url=url,
        source="demo",
        location=loc,
        specifications=Specifications(
            ulez_compliant=ulez,
            annual_tax_gbp=tax,
            mpg_combined=mpg,
            insurance_group=insurance,
            mot_status=mot,
            tax_status="Taxed",
            euro_status=euro,
            fuel_type=fuel,
        ),
        key_features=features,
    )


def all_demo_vehicles() -> list[VehicleResult]:
    man = _dealer_manchester()
    stockport = _dealer_stockport()
    return [
        _car(
            make="Volkswagen",
            model="Golf",
            trim="R-Line",
            year=2021,
            mileage=32000,
            price=14500,
            vrm="AB21CDE",
            dealer=man,
            seller_type="dealer",
            fuel="Petrol",
            mpg=48.7,
            tax=180,
            insurance="19E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Adaptive Cruise Control", "Digital Cockpit", "Heated Seats"],
            url="https://www.autotrader.co.uk/car-details/demo-golf-rline",
        ),
        _car(
            make="Toyota",
            model="Corolla",
            trim="Icon Tech",
            year=2020,
            mileage=28000,
            price=13995,
            vrm="YT20COR",
            dealer=man,
            seller_type="dealer",
            fuel="Hybrid",
            mpg=62.8,
            tax=180,
            insurance="16E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Toyota Safety Sense", "Apple CarPlay", "Reverse Camera"],
            url="https://www.autotrader.co.uk/car-details/demo-corolla-icon",
        ),
        _car(
            make="Honda",
            model="Civic",
            trim="Sport",
            year=2019,
            mileage=41000,
            price=12500,
            vrm="HN19CIV",
            dealer=man,
            seller_type="dealer",
            fuel="Petrol",
            mpg=47.9,
            tax=180,
            insurance="18E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Honda Sensing", "Parking Sensors", "Dual-Zone Climate"],
            url="https://www.autotrader.co.uk/car-details/demo-civic-sport",
        ),
        _car(
            make="Nissan",
            model="Qashqai",
            trim="Acenta Premium",
            year=2018,
            mileage=52000,
            price=11995,
            vrm="NQ18QSH",
            dealer=man,
            seller_type="dealer",
            fuel="Petrol",
            mpg=44.8,
            tax=180,
            insurance="17E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Around View Monitor", "Lane Assist", "Climate Control"],
            url="https://www.autotrader.co.uk/car-details/demo-qashqai-acenta",
        ),
        _car(
            make="BMW",
            model="3 Series",
            trim="320d M Sport",
            year=2019,
            mileage=45000,
            price=14950,
            vrm="BM19THW",
            dealer=stockport,
            seller_type="dealer",
            fuel="Diesel",
            mpg=60.1,
            tax=180,
            insurance="28E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["M Sport Pack", "Sat Nav", "Heated Seats"],
            url="https://www.autotrader.co.uk/car-details/demo-320d-msport",
        ),
        _car(
            make="Ford",
            model="Fiesta",
            trim="ST-Line",
            year=2020,
            mileage=22000,
            price=11200,
            vrm="FD20FST",
            dealer=stockport,
            seller_type="dealer",
            fuel="Petrol",
            mpg=54.3,
            tax=180,
            insurance="14E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Sports Suspension", "SYNC 3", "Cruise Control"],
            url="https://www.autotrader.co.uk/car-details/demo-fiesta-stline",
        ),
        _car(
            make="Volkswagen",
            model="Golf",
            trim="Life",
            year=2022,
            mileage=18000,
            price=16400,
            vrm="VW22LIF",
            dealer=stockport,
            seller_type="dealer",
            fuel="Petrol",
            mpg=50.4,
            tax=180,
            insurance="18E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Digital Cockpit Pro", "Adaptive Cruise", "LED Headlights"],
            url="https://www.autotrader.co.uk/car-details/demo-golf-life",
        ),
        _car(
            make="Ford",
            model="Fiesta",
            trim="Zetec",
            year=2017,
            mileage=68000,
            price=6500,
            vrm="FD17ZET",
            dealer=None,
            seller_type="private",
            fuel="Petrol",
            mpg=55.4,
            tax=180,
            insurance="10E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Bluetooth", "Air Conditioning"],
            url="https://www.autotrader.co.uk/car-details/demo-fiesta-zetec-private",
            private_postcode="M20 6PF",
        ),
        _car(
            make="Audi",
            model="A3",
            trim="S line",
            year=2018,
            mileage=61000,
            price=13250,
            vrm="AU18SLN",
            dealer=stockport,
            seller_type="dealer",
            fuel="Petrol",
            mpg=49.6,
            tax=180,
            insurance="26E",
            ulez=True,
            mot="Valid",
            euro="Euro 6",
            features=["Virtual Cockpit", "LED Lights", "Heated Seats"],
            url="https://www.autotrader.co.uk/car-details/demo-a3-sline",
        ),
    ]


def matches_filters(vehicle: VehicleResult, params: SearchParams) -> bool:
    if vehicle.price_gbp is not None and vehicle.price_gbp > params.budget_max:
        return False
    if params.fuel_type:
        fuel = (vehicle.specifications.fuel_type or "").lower()
        wanted = {item.lower() for item in params.fuel_type}
        if fuel and not any(item in fuel for item in wanted):
            return False
    if params.features:
        haystack = " ".join(vehicle.key_features + [vehicle.trim or ""]).lower()
        if not all(feat.lower() in haystack for feat in params.features):
            return False
    return True


class DemoScraper(Scraper):
    name = "demo"

    def search(self, params: SearchParams, *, headed: bool = False) -> list[VehicleResult]:
        del headed
        return [replace(v) for v in all_demo_vehicles() if matches_filters(v, params)]

    def enrich_dealer_stock(self, stock_url: str, *, headed: bool = False) -> list[VehicleResult]:
        del headed
        dealers = {d.stock_url: d.name for d in demo_dealers()}
        name = dealers.get(stock_url)
        if not name:
            return []
        return [
            replace(v)
            for v in all_demo_vehicles()
            if v.seller_type == "dealer" and v.location.dealer_name == name
        ]
