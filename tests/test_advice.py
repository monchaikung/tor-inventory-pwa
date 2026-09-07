from uk_car_advisor.advice import advise_model, lookup_model_entry, price_position
from uk_car_advisor.models import SearchParams
from uk_car_advisor.scrapers.demo import DemoScraper
from uk_car_advisor.search import persist_results


def test_curated_golf_advice():
    entry = lookup_model_entry("Volkswagen", "Golf")
    assert entry is not None
    assert any("DSG" in item for item in entry["common_issues"])


def test_price_position_bands():
    assert price_position(10000, 12000) == "cheaper than average"
    assert price_position(12000, 12000) == "typical"
    assert price_position(14000, 12000) == "asking high"
    assert price_position(None, 12000) == "unknown"


def test_local_price_stats_and_fallback(db):
    params = SearchParams("M1 1AE", 100, 20000, [])
    vehicles = DemoScraper().search(params)
    search_id, stored = persist_results(db, params, vehicles)
    golfs = [v for v in stored if v.make == "Volkswagen" and v.model == "Golf"]
    advice = advise_model(golfs[0], db, search_id=search_id)
    assert advice.has_curated
    assert advice.stats["count"] == 2
    assert advice.stats["min"] == 14500
    assert advice.stats["max"] == 16400
    assert advice.stats["average"] == 15450

    unknown = stored[0]
    unknown.make = "Fictional"
    unknown.model = "Widget"
    unknown.specifications.fuel_type = "Diesel"
    fallback = advise_model(unknown, db, search_id=search_id)
    assert not fallback.has_curated
    assert fallback.fallback_note
    assert any("DPF" in item for item in fallback.common_issues)
