from __future__ import annotations

import re
from urllib.parse import urlencode

from uk_car_advisor.models import Location, SearchParams, Specifications, VehicleResult
from uk_car_advisor.scrapers.base import Scraper
from uk_car_advisor.scrapers.html_utils import (
    abs_url,
    html_to_text,
    parse_mileage,
    parse_postcode,
    parse_price,
    parse_year,
)

CARWOW_ORIGIN = "https://www.carwow.co.uk"


def build_search_url(params: SearchParams) -> str:
    query = {
        "postcode": params.postcode,
        "max_price": str(params.budget_max),
        "distance": str(params.radius_miles),
    }
    if params.fuel_type:
        query["fuel_type"] = ",".join(params.fuel_type)
    return f"{CARWOW_ORIGIN}/used-cars?{urlencode(query)}"


def parse_search_html(html: str) -> list[VehicleResult]:
    vehicles: list[VehicleResult] = []
    seen: set[str] = set()
    for match in re.finditer(r'href="([^"]+/used-cars/[^"]+)"', html, re.I):
        href = match.group(1)
        if "?" in href and "postcode" in href:
            continue
        url = abs_url(CARWOW_ORIGIN, href.split("?")[0])
        if not url or url in seen or url.rstrip("/") == f"{CARWOW_ORIGIN}/used-cars":
            continue
        seen.add(url)
        start = max(0, match.start() - 400)
        end = min(len(html), match.end() + 800)
        snippet = html_to_text(html[start:end])
        title = snippet.strip().split("\n")[0][:80]
        parts = title.split()
        make = parts[0] if parts else "Unknown"
        model = parts[1] if len(parts) > 1 else "Unknown"
        vehicles.append(
            VehicleResult(
                make=make,
                model=model,
                trim=" ".join(parts[2:]) or None,
                year=parse_year(snippet),
                mileage=parse_mileage(snippet),
                price_gbp=parse_price(snippet),
                seller_type="dealer",
                listing_url=url,
                source="carwow",
                location=Location(
                    dealer_name="Carwow partner dealer",
                    postcode=parse_postcode(snippet) or "",
                ),
                specifications=Specifications(),
            )
        )
        if len(vehicles) >= 20:
            break
    return vehicles


class CarwowScraper(Scraper):
    name = "carwow"

    def search(self, params: SearchParams, *, headed: bool = False) -> list[VehicleResult]:
        from uk_car_advisor.browser import browser_page

        url = build_search_url(params)
        with browser_page(headed=headed) as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
            html = page.content()
        vehicles = parse_search_html(html)
        if not vehicles:
            raise RuntimeError("Carwow returned no listings (blocked or layout change).")
        return vehicles
