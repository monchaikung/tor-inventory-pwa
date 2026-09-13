from __future__ import annotations

from abc import ABC, abstractmethod

from uk_car_advisor.models import SearchParams, VehicleResult


class Scraper(ABC):
    name: str = "base"

    @abstractmethod
    def search(
        self,
        params: SearchParams,
        *,
        headed: bool = False,
    ) -> list[VehicleResult]:
        raise NotImplementedError

    def enrich_dealer_stock(
        self,
        stock_url: str,
        *,
        headed: bool = False,
    ) -> list[VehicleResult]:
        return []
