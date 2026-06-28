"""Tiingo data provider — daily prices and news."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_PRICE_BASE = "https://api.tiingo.com/tiingo/daily"
_NEWS_BASE = "https://api.tiingo.com/tiingo/news"


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

    async def fetch_news(self, tickers: list[str], limit: int = 5) -> dict[str, list[dict]]:
        if not settings.tiingo_api_key:
            return {}

        headers = _headers()
        results: dict[str, list[dict]] = {}

        async with httpx.AsyncClient(timeout=20) as client:
            for i in range(0, len(tickers), 5):
                batch = tickers[i : i + 5]
                symbols = ",".join(batch)
                try:
                    resp = await client.get(
                        _NEWS_BASE,
                        headers=headers,
                        params={"tickers": symbols, "limit": limit * len(batch)},
                    )
                    if resp.status_code == 200:
                        articles = resp.json()
                        for article in articles:
                            for tag in article.get("tickers", []):
                                tag_upper = tag.upper()
                                if tag_upper in batch:
                                    if tag_upper not in results:
                                        results[tag_upper] = []
                                    results[tag_upper].append({
                                        "title": article.get("title", ""),
                                        "source": article.get("source", ""),
                                        "published": article.get("publishedDate", ""),
                                        "url": article.get("url", ""),
                                        "description": (article.get("description") or "")[:300],
                                    })
                except Exception as e:
                    print(f"[tiingo] news batch failed: {e}")
                if i + 5 < len(tickers):
                    await asyncio.sleep(0.3)

        return results

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        return await self.fetch_prices(tickers)
