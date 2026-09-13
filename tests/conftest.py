from __future__ import annotations

from pathlib import Path

import pytest

from uk_car_advisor.db import CarDatabase
from uk_car_advisor.models import Coordinates


@pytest.fixture
def db(tmp_path: Path) -> CarDatabase:
    return CarDatabase(tmp_path / "cars.db")


@pytest.fixture
def manchester() -> Coordinates:
    return Coordinates(
        latitude=53.4808,
        longitude=-2.2369,
        postcode="M1 1AE",
        admin_district="Manchester",
        region="North West",
    )


@pytest.fixture
def mock_postcodes(monkeypatch, manchester: Coordinates):
    def fake_lookup(postcode: str, **kwargs):
        from uk_car_advisor.postcode import is_valid_uk_postcode, normalize_postcode

        if not is_valid_uk_postcode(postcode):
            from uk_car_advisor.postcode import PostcodeError

            raise PostcodeError("invalid")
        known = {
            "M11AE": manchester,
            "M1 1AE": manchester,
            "M44BF": Coordinates(53.4872, -2.2301, "M4 4BF", "Manchester", "North West"),
            "M4 4BF": Coordinates(53.4872, -2.2301, "M4 4BF", "Manchester", "North West"),
            "LS14DY": Coordinates(53.4085, -2.1619, "SK1 1AA", "Stockport", "North West"),
            "LS1 4DY": Coordinates(53.4085, -2.1619, "SK1 1AA", "Stockport", "North West"),
            "SK11AA": Coordinates(53.4085, -2.1619, "SK1 1AA", "Stockport", "North West"),
            "SK1 1AA": Coordinates(53.4085, -2.1619, "SK1 1AA", "Stockport", "North West"),
            "M206PF": Coordinates(53.4174, -2.2312, "M20 6PF", "Manchester", "North West"),
            "M20 6PF": Coordinates(53.4174, -2.2312, "M20 6PF", "Manchester", "North West"),
        }
        key = normalize_postcode(postcode)
        compact = key.replace(" ", "")
        return known.get(key) or known.get(compact) or manchester

    monkeypatch.setattr("uk_car_advisor.postcode.lookup_postcode", fake_lookup)
    monkeypatch.setattr("uk_car_advisor.search.lookup_postcode", fake_lookup)
    monkeypatch.setattr("uk_car_advisor.dealers.lookup_postcode", fake_lookup)
    return fake_lookup
