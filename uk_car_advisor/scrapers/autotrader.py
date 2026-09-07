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

AUTO_TRADER_SEARCH = "https://www.autotrader.co.uk/car-search"
AUTO_TRADER_ORIGIN = "https://www.autotrader.co.uk"


def build_search_url(params: SearchParams) -> str:
    query: list[tuple[str, str]] = [
        ("postcode", params.postcode.replace(" ", "")),
        ("radius", str(params.radius_miles)),
        ("price-to", str(params.budget_max)),
        ("sort", "relevance"),
    ]
    for fuel in params.fuel_type:
        query.append(("fuel-type", fuel))
    return f"{AUTO_TRADER_SEARCH}?{urlencode(query)}"


def _split_title(title: str) -> tuple[str, str, str | None]:
    cleaned = re.sub(r"\s+", " ", title).strip()
    cleaned = re.sub(r"^(19|20)\d{2}\s+", "", cleaned)
    parts = cleaned.split(" ")
    if len(parts) < 2:
        return cleaned, "", None
    make = parts[0]
    model = parts[1]
    trim = " ".join(parts[2:]) or None
    return make, model, trim


_LISTING_HREF = re.compile(
    r'<a[^>]+href="([^"]+/car-details/[^"]+)"[^>]*>(.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)
_ARTICLE = re.compile(
    r"<(?:article|li|div)[^>]*(?:search-page__result|advertCard|listing-card)[^>]*>(.*?)</(?:article|li|div)>",
    re.IGNORECASE | re.DOTALL,
)
_PHONE = re.compile(r"(\+44\s?\d[\d\s]{8,}|0\d[\d\s]{8,})")


def parse_search_html(html: str, *, source: str = "autotrader") -> list[VehicleResult]:
    vehicles: list[VehicleResult] = []
    seen: set[str] = set()
    blocks = _ARTICLE.findall(html)
    if not blocks:
        blocks = [html]

    for block in blocks:
        text = html_to_text(block)
        href_match = re.search(
            r'href="([^"]*car-details[^"]+)"',
            block,
            re.IGNORECASE,
        )
        if not href_match:
            continue
        url = abs_url(AUTO_TRADER_ORIGIN, href_match.group(1).split("?")[0])
        if not url or url in seen:
            continue
        seen.add(url)
        price = parse_price(text)
        mileage = parse_mileage(text)
        year = parse_year(text)
        postcode = parse_postcode(text) or ""
        title_match = re.search(
            r"(?:<h[1-3][^>]*>|<span[^>]*title[^>]*>)([^<]+)",
            block,
            re.IGNORECASE,
        )
        title = html_to_text(title_match.group(1) if title_match else text[:180])
        make, model, trim = _split_title(title)
        seller = "private" if re.search(r"\bprivate\b", text, re.I) else "dealer"
        dealer_name = "Private seller" if seller == "private" else _guess_dealer_name(text)
        stock = None
        stock_match = re.search(r'href="([^"]*dealer[^"]*)"', block, re.I)
        if stock_match:
            stock = abs_url(AUTO_TRADER_ORIGIN, stock_match.group(1))
        vehicles.append(
            VehicleResult(
                make=make or "Unknown",
                model=model or "Unknown",
                trim=trim,
                year=year,
                mileage=mileage,
                price_gbp=price,
                seller_type=seller,  # type: ignore[arg-type]
                listing_url=url,
                source=source,
                location=Location(
                    dealer_name=dealer_name,
                    postcode=postcode,
                    stock_url=stock,
                ),
                specifications=Specifications(),
            )
        )
    return vehicles


def _guess_dealer_name(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if not line or len(line) < 3:
            continue
        if re.search(r"£|miles|save|write-off", line, re.I):
            continue
        if re.search(r"\b(ltd|limited|motors|cars|autos|garage|motor)\b", line, re.I):
            return line[:80]
    return "Trade seller"


def parse_dealer_html(html: str, *, dealer_name: str, postcode: str) -> list[VehicleResult]:
    vehicles = parse_search_html(html)
    for vehicle in vehicles:
        vehicle.location.dealer_name = dealer_name
        if postcode and not vehicle.location.postcode:
            vehicle.location.postcode = postcode
        vehicle.seller_type = "dealer"
    return vehicles


def parse_contact_from_html(html: str) -> dict[str, str | None]:
    text = html_to_text(html)
    phone_match = _PHONE.search(text)
    website = None
    web_match = re.search(r'href="(https?://(?!www\.autotrader)[^"]+)"', html, re.I)
    if web_match:
        website = web_match.group(1)
    address = None
    pc = parse_postcode(text)
    if pc:
        for line in text.splitlines():
            if pc.replace(" ", "") in line.replace(" ", "").upper() or pc in line.upper():
                address = line.strip()[:160]
                break
    return {"phone": phone_match.group(1).strip() if phone_match else None, "website": website, "address": address}


class AutoTraderScraper(Scraper):
    name = "autotrader"

    def search(self, params: SearchParams, *, headed: bool = False) -> list[VehicleResult]:
        from uk_car_advisor.browser import browser_page

        url = build_search_url(params)
        with browser_page(headed=headed) as page:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
            html = page.content()
        vehicles = parse_search_html(html)
        if not vehicles:
            raise RuntimeError(
                "AutoTrader returned no listings (blocked, layout change, or empty search)."
            )
        return vehicles[:25]

    def enrich_dealer_stock(self, stock_url: str, *, headed: bool = False) -> list[VehicleResult]:
        from uk_car_advisor.browser import browser_page

        with browser_page(headed=headed) as page:
            page.goto(stock_url, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            html = page.content()
        return parse_search_html(html)[:20]
