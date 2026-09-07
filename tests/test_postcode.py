from uk_car_advisor.postcode import is_valid_uk_postcode, normalize_postcode, PostcodeError, lookup_postcode
import pytest


@pytest.mark.parametrize(
    "value,expected",
    [
        ("M1 1AE", True),
        ("m11ae", True),
        ("EC1A 1BB", True),
        ("GIR 0AA", True),
        ("SW1A 1AA", True),
        ("not a postcode", False),
        ("12345", False),
        ("", False),
    ],
)
def test_uk_postcode_validation(value, expected):
    assert is_valid_uk_postcode(value) is expected


def test_normalize_postcode():
    assert normalize_postcode("m11ae") == "M1 1AE"
    assert normalize_postcode("EC1A1BB") == "EC1A 1BB"


def test_lookup_postcode_success(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "status": 200,
                "result": {
                    "postcode": "M1 1AE",
                    "latitude": 53.48,
                    "longitude": -2.24,
                    "admin_district": "Manchester",
                    "region": "North West",
                },
            }

    class FakeClient:
        def __init__(self, timeout=10.0):
            self.timeout = timeout

        def get(self, url):
            assert "M11AE" in url
            return FakeResponse()

        def close(self):
            return None

    monkeypatch.setattr("uk_car_advisor.postcode.httpx.Client", FakeClient)
    coords = lookup_postcode("M1 1AE")
    assert coords.admin_district == "Manchester"
    assert coords.latitude == 53.48


def test_lookup_rejects_invalid():
    with pytest.raises(PostcodeError):
        lookup_postcode("zzzz")
