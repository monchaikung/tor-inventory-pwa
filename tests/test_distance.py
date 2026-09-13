from uk_car_advisor.distance import haversine_miles


def test_haversine_same_point():
    assert haversine_miles(53.48, -2.24, 53.48, -2.24) == 0.0


def test_manchester_to_leeds_is_about_forty_miles():
    miles = haversine_miles(53.4808, -2.2369, 53.7965, -1.5506)
    assert 35 < miles < 50
