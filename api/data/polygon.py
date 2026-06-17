"""Polygon.io data provider — benchmarks only (SPY/QQQ/sector ETFs for regime)."""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

import httpx

from api.config.settings import settings
from api.data.base import DataProvider


class PolygonProvider(DataProvider):
    BASE = "https://api.polygon.io"

    @property
    def name(self) -> str:
        return "polygon"

    async def fetch(self, tickers: list[str], **kwargs) -> dict:
        """Not used — per-ticker market data now comes from Yahoo batch download."""
        return {}

    async def fetch_benchmarks(self) -> dict:
        """Fetch SPY, QQQ, and sector ETF data for regime detection.

        Only ~13 API calls — fits comfortably in Polygon free tier (5/min).
        """
        if not settings.polygon_api_key:
            return {}

        benchmarks = {}
        today = date.today()
        start = (today - timedelta(days=35)).strftime("%Y-%m-%d")
        end = (today - timedelta(days=1)).strftime("%Y-%m-%d")

        async with httpx.AsyncClient(timeout=15) as client:
            # SPY + QQQ: 2 calls
            for symbol in ["SPY", "QQQ"]:
                try:
                    resp = await client.get(
                        f"{self.BASE}/v2/aggs/ticker/{symbol}/range/1/day/{start}/{end}",
                        params={"adjusted": "true", "sort": "asc", "apiKey": settings.polygon_api_key},
                    )
                    if resp.status_code == 200:
                        bars = resp.json().get("results", [])
                        if bars:
                            closes = [b["c"] for b in bars]
                            current = closes[-1]
                            c5 = closes[-6] if len(closes) >= 6 else closes[0]
                            c20 = closes[0] if len(closes) >= 15 else closes[0]

                            daily_returns = [(closes[j] - closes[j-1]) / closes[j-1] for j in range(1, len(closes))]
                            mean_r = sum(daily_returns) / len(daily_returns) if daily_returns else 0
                            var = sum((r - mean_r) ** 2 for r in daily_returns) / max(len(daily_returns), 1)
                            rvol = (var ** 0.5) * (252 ** 0.5)

                            key = symbol.lower()
                            benchmarks[f"{key}_return_5d"] = round((current - c5) / c5, 5) if c5 else 0
                            benchmarks[f"{key}_return_20d"] = round((current - c20) / c20, 5) if c20 else 0
                            benchmarks[f"{key}_realized_vol_20d"] = round(rvol, 4)
                    elif resp.status_code == 429:
                        await asyncio.sleep(12)
                except Exception:
                    pass

                await asyncio.sleep(12)

            # Sector ETFs for breadth: 11 calls with 12s spacing = ~2.2 min
            sector_etfs = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLC", "XLY", "XLP", "XLU", "XLB", "XLRE"]
            positive_count = 0
            total_count = 0
            for etf in sector_etfs:
                try:
                    resp = await client.get(
                        f"{self.BASE}/v2/aggs/ticker/{etf}/range/1/day/{start}/{end}",
                        params={"adjusted": "true", "sort": "asc", "apiKey": settings.polygon_api_key},
                    )
                    if resp.status_code == 200:
                        bars = resp.json().get("results", [])
                        if bars and len(bars) >= 15:
                            ret = (bars[-1]["c"] - bars[0]["c"]) / bars[0]["c"]
                            total_count += 1
                            if ret > 0:
                                positive_count += 1
                    elif resp.status_code == 429:
                        await asyncio.sleep(12)
                except Exception:
                    pass
                await asyncio.sleep(12)

            if total_count > 0:
                benchmarks["sector_positive_ratio_20d"] = round(positive_count / total_count, 3)

        return benchmarks
