"""Polygon.io data provider — OHLCV bars, technicals, and market snapshot."""
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
        """Return market_data dict keyed by ticker with OHLCV and technicals."""
        if not settings.polygon_api_key:
            return {}

        market_data: dict[str, dict] = {}
        today = date.today()
        start_20d = (today - timedelta(days=35)).strftime("%Y-%m-%d")
        end = (today - timedelta(days=1)).strftime("%Y-%m-%d")

        async with httpx.AsyncClient(timeout=15) as client:
            for i, ticker in enumerate(tickers):
                if i > 0 and i % 5 == 0:
                    await asyncio.sleep(0.5)

                try:
                    resp = await client.get(
                        f"{self.BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start_20d}/{end}",
                        params={"adjusted": "true", "sort": "asc", "apiKey": settings.polygon_api_key},
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        bars = data.get("results", [])
                        if not bars:
                            continue

                        closes = [b["c"] for b in bars]
                        volumes = [b["v"] for b in bars]
                        highs = [b["h"] for b in bars]
                        lows = [b["l"] for b in bars]

                        current = closes[-1]
                        close_5d_ago = closes[-6] if len(closes) >= 6 else closes[0]
                        close_20d_ago = closes[0] if len(closes) >= 15 else closes[0]

                        ret_5d = (current - close_5d_ago) / close_5d_ago if close_5d_ago else 0
                        ret_20d = (current - close_20d_ago) / close_20d_ago if close_20d_ago else 0

                        avg_vol_20d = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
                        recent_vol = volumes[-1] if volumes else 0
                        vol_ratio = recent_vol / avg_vol_20d if avg_vol_20d > 0 else 1.0

                        # Simple realized vol (20d)
                        if len(closes) >= 5:
                            daily_returns = [(closes[j] - closes[j-1]) / closes[j-1] for j in range(1, len(closes))]
                            mean_ret = sum(daily_returns) / len(daily_returns)
                            variance = sum((r - mean_ret) ** 2 for r in daily_returns) / len(daily_returns)
                            realized_vol = (variance ** 0.5) * (252 ** 0.5)
                        else:
                            realized_vol = 0

                        # ATR approximation
                        atr_values = [highs[j] - lows[j] for j in range(max(len(bars) - 14, 0), len(bars))]
                        atr = sum(atr_values) / max(len(atr_values), 1) if atr_values else 0

                        market_data[ticker] = {
                            "close": current,
                            "return_5d": round(ret_5d, 5),
                            "return_20d": round(ret_20d, 5),
                            "volume": recent_vol,
                            "avg_volume_20d": round(avg_vol_20d),
                            "volume_ratio": round(vol_ratio, 3),
                            "realized_vol_20d": round(realized_vol, 4),
                            "atr_14d": round(atr, 2),
                            "high_20d": max(highs[-20:]) if highs else current,
                            "low_20d": min(lows[-20:]) if lows else current,
                        }
                    elif resp.status_code == 429:
                        await asyncio.sleep(2)

                except Exception:
                    pass

        return market_data

    async def fetch_benchmarks(self) -> dict:
        """Fetch SPY, QQQ, VIX data for regime detection."""
        if not settings.polygon_api_key:
            return {}

        benchmarks = {}
        today = date.today()
        start = (today - timedelta(days=35)).strftime("%Y-%m-%d")
        end = (today - timedelta(days=1)).strftime("%Y-%m-%d")

        async with httpx.AsyncClient(timeout=15) as client:
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
                except Exception:
                    pass

                await asyncio.sleep(0.3)

            # Sector ETFs for breadth
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
                except Exception:
                    pass
                await asyncio.sleep(0.2)

            if total_count > 0:
                benchmarks["sector_positive_ratio_20d"] = round(positive_count / total_count, 3)

        return benchmarks
