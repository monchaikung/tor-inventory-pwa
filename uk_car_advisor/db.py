from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from uk_car_advisor.models import (
    Dealer,
    Location,
    SearchParams,
    Specifications,
    VehicleResult,
)

DEFAULT_DB_PATH = Path("cars.db")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_load(value: str | None, default: Any) -> Any:
    if not value:
        return default
    return json.loads(value)


class CarDatabase:
    def __init__(self, path: str | Path = DEFAULT_DB_PATH) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS searches (
                    id INTEGER PRIMARY KEY,
                    postcode TEXT NOT NULL,
                    radius_miles INTEGER,
                    budget_max INTEGER,
                    fuel_types TEXT,
                    features TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS dealers (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    postcode TEXT,
                    address TEXT,
                    phone TEXT,
                    website TEXT,
                    stock_url TEXT,
                    source TEXT,
                    admin_district TEXT,
                    latitude REAL,
                    longitude REAL,
                    last_seen TEXT NOT NULL,
                    UNIQUE(name, postcode)
                );

                CREATE TABLE IF NOT EXISTS vehicles (
                    id INTEGER PRIMARY KEY,
                    search_id INTEGER,
                    dealer_id INTEGER,
                    vrm TEXT,
                    make TEXT NOT NULL,
                    model TEXT NOT NULL,
                    trim TEXT,
                    year INTEGER,
                    mileage INTEGER,
                    price_gbp INTEGER,
                    seller_type TEXT NOT NULL,
                    listing_url TEXT NOT NULL,
                    source TEXT,
                    dealer_name TEXT,
                    location_postcode TEXT,
                    distance_miles REAL,
                    ulez_compliant INTEGER,
                    annual_tax_gbp INTEGER,
                    mpg_combined REAL,
                    insurance_group TEXT,
                    mot_status TEXT,
                    tax_status TEXT,
                    euro_status TEXT,
                    fuel_type TEXT,
                    key_features TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (search_id) REFERENCES searches(id),
                    FOREIGN KEY (dealer_id) REFERENCES dealers(id),
                    UNIQUE(search_id, listing_url)
                );
                """
            )

    def insert_search(self, params: SearchParams) -> int:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO searches (postcode, radius_miles, budget_max, fuel_types, features, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    params.postcode,
                    params.radius_miles,
                    params.budget_max,
                    _json_dump(params.fuel_type),
                    _json_dump(params.features),
                    _utc_now(),
                ),
            )
            return int(cursor.lastrowid)

    def upsert_dealer(self, dealer: Dealer) -> int:
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT id FROM dealers WHERE name = ? AND postcode = ?",
                (dealer.name, dealer.postcode),
            ).fetchone()
            now = _utc_now()
            if existing:
                conn.execute(
                    """
                    UPDATE dealers SET
                        address = COALESCE(?, address),
                        phone = COALESCE(?, phone),
                        website = COALESCE(?, website),
                        stock_url = COALESCE(?, stock_url),
                        source = COALESCE(?, source),
                        admin_district = COALESCE(?, admin_district),
                        latitude = COALESCE(?, latitude),
                        longitude = COALESCE(?, longitude),
                        last_seen = ?
                    WHERE id = ?
                    """,
                    (
                        dealer.address,
                        dealer.phone,
                        dealer.website,
                        dealer.stock_url,
                        dealer.source,
                        dealer.admin_district,
                        dealer.latitude,
                        dealer.longitude,
                        now,
                        existing["id"],
                    ),
                )
                return int(existing["id"])
            cursor = conn.execute(
                """
                INSERT INTO dealers (
                    name, postcode, address, phone, website, stock_url, source,
                    admin_district, latitude, longitude, last_seen
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    dealer.name,
                    dealer.postcode,
                    dealer.address,
                    dealer.phone,
                    dealer.website,
                    dealer.stock_url,
                    dealer.source,
                    dealer.admin_district,
                    dealer.latitude,
                    dealer.longitude,
                    now,
                ),
            )
            return int(cursor.lastrowid)

    def get_dealer(self, dealer_id: int) -> Dealer | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM dealers WHERE id = ?", (dealer_id,)).fetchone()
        return _row_to_dealer(row) if row else None

    def find_dealer(self, name: str, postcode: str) -> Dealer | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM dealers WHERE name = ? AND postcode = ?",
                (name, postcode),
            ).fetchone()
        return _row_to_dealer(row) if row else None

    def insert_vehicle(self, vehicle: VehicleResult) -> int:
        spec = vehicle.specifications
        ulez = spec.ulez_compliant
        ulez_int = None if ulez is None else int(ulez)
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO vehicles (
                    search_id, dealer_id, vrm, make, model, trim, year, mileage, price_gbp,
                    seller_type, listing_url, source, dealer_name, location_postcode,
                    distance_miles, ulez_compliant, annual_tax_gbp, mpg_combined,
                    insurance_group, mot_status, tax_status, euro_status, fuel_type,
                    key_features, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(search_id, listing_url) DO UPDATE SET
                    price_gbp = excluded.price_gbp,
                    mileage = excluded.mileage,
                    dealer_id = COALESCE(excluded.dealer_id, vehicles.dealer_id),
                    distance_miles = excluded.distance_miles,
                    ulez_compliant = COALESCE(excluded.ulez_compliant, vehicles.ulez_compliant),
                    mot_status = COALESCE(excluded.mot_status, vehicles.mot_status),
                    tax_status = COALESCE(excluded.tax_status, vehicles.tax_status)
                """,
                (
                    vehicle.search_id,
                    vehicle.dealer_id,
                    vehicle.vrm,
                    vehicle.make,
                    vehicle.model,
                    vehicle.trim,
                    vehicle.year,
                    vehicle.mileage,
                    vehicle.price_gbp,
                    vehicle.seller_type,
                    vehicle.listing_url,
                    vehicle.source,
                    vehicle.location.dealer_name,
                    vehicle.location.postcode,
                    vehicle.location.distance_miles,
                    ulez_int,
                    spec.annual_tax_gbp,
                    spec.mpg_combined,
                    spec.insurance_group,
                    spec.mot_status,
                    spec.tax_status,
                    spec.euro_status,
                    spec.fuel_type,
                    _json_dump(vehicle.key_features),
                    _utc_now(),
                ),
            )
            vehicle_id = cursor.lastrowid
            if not vehicle_id:
                row = conn.execute(
                    "SELECT id FROM vehicles WHERE search_id = ? AND listing_url = ?",
                    (vehicle.search_id, vehicle.listing_url),
                ).fetchone()
                vehicle_id = row["id"]
            return int(vehicle_id)

    def list_vehicles(self, search_id: int) -> list[VehicleResult]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM vehicles WHERE search_id = ? ORDER BY price_gbp IS NULL, price_gbp",
                (search_id,),
            ).fetchall()
        return [_row_to_vehicle(row) for row in rows]

    def get_vehicle(self, vehicle_id: int) -> VehicleResult | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM vehicles WHERE id = ?", (vehicle_id,)).fetchone()
        return _row_to_vehicle(row) if row else None

    def vehicles_for_dealer(
        self,
        dealer_id: int,
        *,
        exclude_vehicle_id: int | None = None,
    ) -> list[VehicleResult]:
        sql = "SELECT * FROM vehicles WHERE dealer_id = ?"
        params: list[Any] = [dealer_id]
        if exclude_vehicle_id is not None:
            sql += " AND id != ?"
            params.append(exclude_vehicle_id)
        sql += " ORDER BY price_gbp IS NULL, price_gbp"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return _unique_urls(_row_to_vehicle(r) for r in rows)

    def vehicles_for_dealer_name(
        self,
        name: str,
        postcode: str,
        *,
        exclude_vehicle_id: int | None = None,
    ) -> list[VehicleResult]:
        sql = "SELECT * FROM vehicles WHERE dealer_name = ? AND location_postcode = ?"
        params: list[Any] = [name, postcode]
        if exclude_vehicle_id is not None:
            sql += " AND id != ?"
            params.append(exclude_vehicle_id)
        sql += " ORDER BY price_gbp IS NULL, price_gbp"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return _unique_urls(_row_to_vehicle(r) for r in rows)

    def price_stats(
        self,
        make: str,
        model: str,
        *,
        search_id: int | None = None,
    ) -> dict[str, Any]:
        sql = """
            SELECT price_gbp, mileage FROM vehicles
            WHERE lower(make) = lower(?) AND lower(model) = lower(?)
              AND price_gbp IS NOT NULL
        """
        params: list[Any] = [make, model]
        if search_id is not None:
            sql += " AND search_id = ?"
            params.append(search_id)
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        prices = [int(r["price_gbp"]) for r in rows]
        mileages = [int(r["mileage"]) for r in rows if r["mileage"] is not None]
        if not prices:
            return {
                "count": 0,
                "min": None,
                "max": None,
                "average": None,
                "median": None,
                "mileage_avg": None,
            }
        prices_sorted = sorted(prices)
        n = len(prices_sorted)
        mid = n // 2
        median = prices_sorted[mid] if n % 2 else (prices_sorted[mid - 1] + prices_sorted[mid]) / 2
        return {
            "count": n,
            "min": prices_sorted[0],
            "max": prices_sorted[-1],
            "average": round(sum(prices_sorted) / n),
            "median": round(median),
            "mileage_avg": round(sum(mileages) / len(mileages)) if mileages else None,
        }


def _row_to_dealer(row: sqlite3.Row) -> Dealer:
    return Dealer(
        id=row["id"],
        name=row["name"],
        postcode=row["postcode"] or "",
        address=row["address"],
        phone=row["phone"],
        website=row["website"],
        stock_url=row["stock_url"],
        source=row["source"] or "demo",
        admin_district=row["admin_district"],
        latitude=row["latitude"],
        longitude=row["longitude"],
    )


def _row_to_vehicle(row: sqlite3.Row) -> VehicleResult:
    ulez = row["ulez_compliant"]
    return VehicleResult(
        id=row["id"],
        search_id=row["search_id"],
        dealer_id=row["dealer_id"],
        vrm=row["vrm"],
        make=row["make"],
        model=row["model"],
        trim=row["trim"],
        year=row["year"],
        mileage=row["mileage"],
        price_gbp=row["price_gbp"],
        seller_type=row["seller_type"],
        listing_url=row["listing_url"],
        source=row["source"] or "demo",
        location=Location(
            dealer_name=row["dealer_name"] or "Unknown",
            postcode=row["location_postcode"] or "",
            distance_miles=row["distance_miles"],
        ),
        specifications=Specifications(
            ulez_compliant=None if ulez is None else bool(ulez),
            annual_tax_gbp=row["annual_tax_gbp"],
            mpg_combined=row["mpg_combined"],
            insurance_group=row["insurance_group"],
            mot_status=row["mot_status"],
            tax_status=row["tax_status"],
            euro_status=row["euro_status"],
            fuel_type=row["fuel_type"],
        ),
        key_features=_json_load(row["key_features"], []),
    )


def _unique_urls(vehicles: Iterable[VehicleResult]) -> list[VehicleResult]:
    seen: set[str] = set()
    out: list[VehicleResult] = []
    for vehicle in vehicles:
        if vehicle.listing_url in seen:
            continue
        seen.add(vehicle.listing_url)
        out.append(vehicle)
    return out
