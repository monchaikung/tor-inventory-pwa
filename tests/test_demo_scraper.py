from uk_car_advisor.models import SearchParams
from uk_car_advisor.scrapers.demo import DemoScraper, all_demo_vehicles
from uk_car_advisor.search import run_search


def test_demo_budget_and_fuel_filters():
    params = SearchParams(
        postcode="M1 1AE",
        radius_miles=50,
        budget_max=15000,
        fuel_type=["Petrol", "Hybrid"],
    )
    results = DemoScraper().search(params)
    prices = [v.price_gbp for v in results]
    assert max(prices) <= 15000
    fuels = {v.specifications.fuel_type for v in results}
    assert "Diesel" not in fuels
    assert any(v.model == "Golf" for v in results)
    assert all(v.model != "3 Series" or v.specifications.fuel_type != "Diesel" for v in results)


def test_demo_has_multi_car_dealers():
    cars = all_demo_vehicles()
    names = [v.location.dealer_name for v in cars if v.seller_type == "dealer"]
    assert names.count("Manchester Autos") >= 3
    assert names.count("Stockport Motor Company") >= 3
    assert any(v.seller_type == "private" for v in cars)


def test_search_round_trip(db, mock_postcodes):
    params = SearchParams(
        postcode="M1 1AE",
        radius_miles=50,
        budget_max=15000,
        fuel_type=["Petrol", "Hybrid"],
    )
    outcome = run_search(params, sources=["demo"], headed=False, db=db, dvla_enrich=False)
    assert outcome.search_id > 0
    assert len(outcome.vehicles) >= 5
    stored = db.list_vehicles(outcome.search_id)
    assert len(stored) == len(outcome.vehicles)
    golf = next(v for v in stored if v.make == "Volkswagen" and v.model == "Golf")
    assert golf.location.distance_miles is not None
    assert golf.location.distance_miles < 5
