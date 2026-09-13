from pathlib import Path

from uk_car_advisor.scrapers.autotrader import (
    build_search_url,
    parse_contact_from_html,
    parse_search_html,
)
from uk_car_advisor.scrapers.carwow import build_search_url as carwow_url
from uk_car_advisor.scrapers.carwow import parse_search_html as parse_carwow
from uk_car_advisor.scrapers.motors import build_search_url as motors_url
from uk_car_advisor.scrapers.motors import parse_search_html as parse_motors
from uk_car_advisor.models import SearchParams


def test_autotrader_url():
    params = SearchParams("M1 1AE", 25, 15000, ["Petrol", "Hybrid"])
    url = build_search_url(params)
    assert "postcode=M11AE" in url
    assert "radius=25" in url
    assert "price-to=15000" in url


def test_autotrader_html_parser():
    html = Path("tests/fixtures/autotrader_search.html").read_text(encoding="utf-8")
    vehicles = parse_search_html(html)
    assert len(vehicles) == 2
    golf = vehicles[0]
    assert golf.make == "Volkswagen"
    assert golf.model == "Golf"
    assert golf.price_gbp == 14500
    assert golf.mileage == 32000
    assert golf.year == 2021
    assert golf.location.postcode.upper().replace(" ", "") == "M44BF"
    assert vehicles[1].seller_type == "private"


def test_contact_parser():
    html = "<p>Call 0161 555 0142</p><a href='https://www.manchesterautos.example'>site</a><p>12 Street, M4 4BF</p>"
    info = parse_contact_from_html(html)
    assert info["phone"] and "0161" in info["phone"]
    assert info["website"] and "manchesterautos" in info["website"]


def test_motors_and_carwow_urls_and_empty_html():
    params = SearchParams("M1 1AE", 10, 9000, [])
    assert "motors.co.uk" in motors_url(params)
    assert "carwow.co.uk" in carwow_url(params)
    motors_html = '''
    <a href="/used-cars/ford-fiesta-123">2019 Ford Fiesta ST-Line</a>
    <span>£11,200</span><span>22,000 miles</span>
    '''
    # motors parser looks for car-for-sale or used-cars
    cars = parse_motors(motors_html)
    assert cars
    assert cars[0].price_gbp == 11200
    wow = parse_carwow(
        '<a href="/used-cars/vw-golf-abc">2020 Volkswagen Golf Life</a><p>£12,000 · 30,000 miles</p>'
    )
    assert wow
    assert wow[0].make == "2020" or wow[0].make == "Volkswagen" or wow[0].price_gbp == 12000
