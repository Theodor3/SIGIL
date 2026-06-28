"""StockTwits data provider — retail sentiment per ticker."""
from __future__ import annotations

import asyncio
import base64

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_BASE = "https://api-gw-prd.stocktwits.com/api-middleware/external"


def _auth_header() -> dict[str, str]:
    creds = f"{settings.stocktwits_username}:{settings.stocktwits_password}"
    token = base64.b64encode(creds.encode()).decode()
    return {"Authorization": f"Basic {token}"}


async def _fetch_sentiment(
    client: httpx.AsyncClient, symbol: str, headers: dict
) -> dict | None:
    try:
        resp = await client.get(
            f"{_BASE}/sentiment/v2/{symbol}/detail",
            headers=headers,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        print(f"[stocktwits] {symbol} sentiment failed: {e}")
    return None


class StockTwitsProvider(DataProvider):
    @property
    def name(self) -> str:
        return "stocktwits"

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        if not settings.stocktwits_username or not settings.stocktwits_password:
            return {}

        headers = _auth_header()
        results: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=15) as client:
            for i in range(0, len(tickers), 10):
                batch = tickers[i : i + 10]
                tasks = [_fetch_sentiment(client, t, headers) for t in batch]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception) or result is None:
                        continue
                    sentiment = result.get("data", result)
                    results[ticker] = {
                        "bullish": sentiment.get("bullish", 0),
                        "bearish": sentiment.get("bearish", 0),
                        "total_messages": sentiment.get("total", 0),
                        "sentiment_score": sentiment.get("sentiment", 0),
                        "change_vs_prev": sentiment.get("change", 0),
                        "_raw": sentiment,
                    }
                if i + 10 < len(tickers):
                    await asyncio.sleep(0.3)

        return results

    async def fetch_trending(self) -> list[dict]:
        if not settings.stocktwits_username or not settings.stocktwits_password:
            return []

        headers = _auth_header()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{_BASE}/api/2/trending/symbols_enhanced.json",
                    headers=headers,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("symbols", data.get("data", []))
        except Exception as e:
            print(f"[stocktwits] trending failed: {e}")
        return []
