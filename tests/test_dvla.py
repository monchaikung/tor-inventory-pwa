from uk_car_advisor.dvla import apply_ves_payload, parse_euro_status, ulez_compliant
from uk_car_advisor.models import VehicleResult


def test_parse_euro_status():
    assert parse_euro_status("Euro 6") == 6
    assert parse_euro_status("EURO6") == 6
    assert parse_euro_status(None) is None


def test_ulez_rules():
    assert ulez_compliant("Electric", None) is True
    assert ulez_compliant("Petrol", "Euro 4") is True
    assert ulez_compliant("Petrol", "Euro 3") is False
    assert ulez_compliant("Diesel", "Euro 6") is True
    assert ulez_compliant("Diesel", "Euro 5") is False
    assert ulez_compliant("Hybrid Electric", "Euro 6") is True
    assert ulez_compliant("Diesel", None) is None


def test_apply_ves_payload():
    vehicle = VehicleResult(make="Volkswagen", model="Golf", listing_url="http://x")
    apply_ves_payload(
        vehicle,
        {
            "fuelType": "PETROL",
            "euroStatus": "EURO 6",
            "motStatus": "Valid",
            "taxStatus": "Taxed",
            "yearOfManufacture": 2021,
        },
    )
    assert vehicle.specifications.ulez_compliant is True
    assert vehicle.specifications.mot_status == "Valid"
    assert vehicle.year == 2021
