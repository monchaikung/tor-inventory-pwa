from uk_car_advisor.dealers import build_dossier
from uk_car_advisor.models import SearchParams
from uk_car_advisor.scrapers.demo import DemoScraper
from uk_car_advisor.search import persist_results


def test_dealer_other_stock(db, mock_postcodes):
    params = SearchParams("M1 1AE", 50, 20000, ["Petrol", "Hybrid", "Diesel"])
    vehicles = DemoScraper().search(params)
    search_id, stored = persist_results(db, params, vehicles)
    golf = next(v for v in stored if v.model == "Golf" and v.trim == "R-Line")
    dossier = build_dossier(db, golf)
    assert not dossier.is_private
    assert dossier.dealer.name == "Manchester Autos"
    assert dossier.dealer.phone
    assert dossier.dealer.address
    others = {v.model for v in dossier.other_stock}
    assert "Corolla" in others
    assert "Civic" in others
    assert "Qashqai" in others
    assert all(v.listing_url != golf.listing_url for v in dossier.other_stock)


def test_private_seller_has_no_stock(db):
    params = SearchParams("M1 1AE", 50, 20000, [])
    vehicles = DemoScraper().search(params)
    _, stored = persist_results(db, params, vehicles)
    private = next(v for v in stored if v.seller_type == "private")
    dossier = build_dossier(db, private)
    assert dossier.is_private
    assert dossier.other_stock == []
