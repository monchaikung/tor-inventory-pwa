from uk_car_advisor.compare import comparison_table
from uk_car_advisor.scrapers.demo import all_demo_vehicles


def test_comparison_table_columns():
    cars = all_demo_vehicles()[:2]
    table = comparison_table(cars)
    assert "Price" in table
    assert "ULEZ" in table
    assert "MOT" in table
    labels = list(table["Price"].keys())
    assert len(labels) == 2
    assert "£14,500" in table["Price"].values() or any("14,500" in v for v in table["Price"].values())
