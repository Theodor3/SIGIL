from abc import ABC, abstractmethod


class DataProvider(ABC):
    """Base class for data providers (Polygon, Finnhub, Yahoo, etc.)."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def fetch(self, tickers: list[str], **kwargs) -> dict:
        ...
