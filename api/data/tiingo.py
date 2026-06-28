"""Tiingo data provider — daily adjusted prices."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_PRICE_BASE = "https://api.tiingo.com/tiingo/daily"


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Token {settings.tiingo_api_key}",
        "Content-Type": "application/json",
    }


class TiingoProvider(DataProvider):
    @property
    def name(self) -> str:
        return "tiingo"

    async def fetch_prices(self, tickers: list[str], days: int = 90) -> dict[str, dict]:
        if not settings.tiingo_api_key:
            return {}

        headers = _headers()
        end = datetime.utcnow().strftime("%Y-%m-%d")
        start = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
        results: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=20) as client:
            for i in range(0, len(tickers), 10):
                batch = tickers[i : i + 10]
                tasks = [
                    client.get(
                        f"{_PRICE_BASE}/{t}/prices",
                        headers=headers,
                        params={"startDate": start, "endDate": end},
                    )
                    for t in batch
                ]
                responses = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, resp in zip(batch, responses):
                    if isinstance(resp, Exception):
                        continue
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    if not data:
                        continue
                    latest = data[-1]
                    closes = [d["adjClose"] for d in data if d.get("adjClose")]
                    results[ticker] = {
                        "close": latest.get("adjClose"),
                        "open": latest.get("adjOpen"),
                        "high": latest.get("adjHigh"),
                        "low": latest.get("adjLow"),
                        "volume": latest.get("volume"),
                        "closes": closes,
                        "_source": "tiingo",
                    }
                if i + 10 < len(tickers):
                    await asyncio.sleep(0.2)

        return results

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        return await self.fetch_prices(tickers)
