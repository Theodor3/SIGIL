"""Nasdaq Data Link (Quandl) provider — macro and alternative datasets."""
from __future__ import annotations

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_BASE = "https://data.nasdaq.com/api/v3"

MACRO_SERIES = {
    "FRED/DFF": "fed_funds_rate",
    "FRED/T10YIE": "breakeven_inflation_10y",
    "FRED/UNRATE": "unemployment_rate",
    "FRED/ICSA": "initial_claims",
    "FRED/UMCSENT": "consumer_sentiment",
    "ML/EMHYY": "em_hy_yield",
}


class NasdaqDataLinkProvider(DataProvider):
    @property
    def name(self) -> str:
        return "nasdaq_data_link"

    async def fetch_macro(self) -> dict[str, float | None]:
        if not settings.nasdaq_data_link_api_key:
            return {}

        macro: dict[str, float | None] = {}
        async with httpx.AsyncClient(timeout=15) as client:
            for dataset, field_name in MACRO_SERIES.items():
                try:
                    resp = await client.get(
                        f"{_BASE}/datasets/{dataset}/data.json",
                        params={
                            "api_key": settings.nasdaq_data_link_api_key,
                            "limit": 1,
                            "order": "desc",
                        },
                    )
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    dataset_data = data.get("dataset_data", {})
                    rows = dataset_data.get("data", [])
                    if rows and len(rows[0]) > 1:
                        macro[field_name] = float(rows[0][1])
                except Exception as e:
                    print(f"[nasdaq_data_link] {dataset} failed: {e}")

        return macro

    async def fetch(self, tickers: list[str] | None = None, **kwargs) -> dict:
        return await self.fetch_macro()
