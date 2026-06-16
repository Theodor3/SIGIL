"""Yahoo Finance data provider — fundamentals via yfinance library."""
from __future__ import annotations

import asyncio
import random
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from api.data.base import DataProvider

_SECTORS = [
    "Technology", "Healthcare", "Consumer Cyclical", "Financial Services",
    "Industrials", "Communication Services", "Consumer Defensive", "Energy",
]


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


def _safe_div(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _fetch_one_sync(symbol: str) -> dict | None:
    """Fetch fundamentals for one ticker using yfinance (sync, runs in thread pool)."""
    try:
        import yfinance as yf
        time.sleep(random.uniform(0.3, 0.8))
        t = yf.Ticker(symbol)
        info = t.info
        if not info or info.get("regularMarketPrice") is None:
            return None

        market_cap = _num(info.get("marketCap"))
        sector = info.get("sector", "")
        industry = info.get("industry", "")

        total_revenue = _num(info.get("totalRevenue"))
        total_debt = _num(info.get("totalDebt", 0))
        ebitda = _num(info.get("ebitda"))
        fcf = _num(info.get("freeCashflow"))
        fcf_margin = _safe_div(fcf, total_revenue)

        roa = _num(info.get("returnOnAssets"))
        roe = _num(info.get("returnOnEquity"))

        total_equity = _num(info.get("bookValue"))
        shares = _num(info.get("sharesOutstanding"))
        if total_equity and shares:
            total_equity = total_equity * shares

        operating_margins = _num(info.get("operatingMargins"))
        operating_income = None
        if operating_margins and total_revenue:
            operating_income = operating_margins * total_revenue

        roic = None
        if operating_income is not None and total_equity is not None:
            invested_cap = (total_equity or 0) + (total_debt or 0)
            if invested_cap > 0:
                roic = operating_income * (1 - 0.21) / invested_cap

        total_assets = _num(info.get("totalAssets"))
        asset_turnover = _safe_div(total_revenue, total_assets) or 0
        debt_to_ebitda = _safe_div(total_debt, ebitda)
        rev_growth = _num(info.get("revenueGrowth"))

        return {
            "roic": roic or (roa if roa else 0),
            "fcf_margin": fcf_margin or 0,
            "asset_turnover": asset_turnover,
            "revenue_cagr_3y": rev_growth or 0,
            "fcf_cagr_3y": 0,
            "debt_to_ebitda": debt_to_ebitda,
            "total_debt": total_debt or 0,
            "total_equity": total_equity or 0,
            "market_cap": market_cap,
            "sector": sector,
            "industry": industry,
            "trailing_pe": _num(info.get("trailingPE")),
            "forward_pe": _num(info.get("forwardPE")),
            "price_to_sales": _num(info.get("priceToSalesTrailing12Months")),
            "ev_to_ebitda": _num(info.get("enterpriseToEbitda")),
            "ev_to_revenue": _num(info.get("enterpriseToRevenue")),
        }
    except Exception:
        return None


def _generate_demo_data(symbol: str, seed: int) -> dict:
    """Generate realistic-looking fundamental data for demo/development."""
    rng = random.Random(seed)
    sector = _SECTORS[seed % len(_SECTORS)]
    market_cap = rng.uniform(5e9, 500e9)
    roic = rng.uniform(0.05, 0.45)
    fcf_margin = rng.uniform(0.02, 0.35)
    rev_growth = rng.uniform(-0.05, 0.40)

    return {
        "roic": round(roic, 4),
        "fcf_margin": round(fcf_margin, 4),
        "asset_turnover": round(rng.uniform(0.3, 2.0), 4),
        "revenue_cagr_3y": round(rev_growth, 4),
        "fcf_cagr_3y": round(rng.uniform(-0.05, 0.30), 4),
        "debt_to_ebitda": round(rng.uniform(0.5, 4.0), 2),
        "total_debt": round(rng.uniform(1e9, 50e9), 0),
        "total_equity": round(rng.uniform(5e9, 100e9), 0),
        "market_cap": round(market_cap, 0),
        "sector": sector,
        "industry": f"{sector} Services",
        "trailing_pe": round(rng.uniform(10, 60), 2),
        "forward_pe": round(rng.uniform(8, 50), 2),
        "price_to_sales": round(rng.uniform(1, 25), 2),
        "ev_to_ebitda": round(rng.uniform(8, 40), 2),
        "ev_to_revenue": round(rng.uniform(2, 20), 2),
    }


class YahooProvider(DataProvider):
    def __init__(self, demo_mode: bool = False):
        self._demo_mode = demo_mode

    @property
    def name(self) -> str:
        return "yahoo"

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        if self._demo_mode:
            return self._fetch_demo(tickers)

        loop = asyncio.get_event_loop()
        executor = ThreadPoolExecutor(max_workers=4)

        async def fetch_one(symbol: str) -> tuple[str, dict | None]:
            data = await loop.run_in_executor(executor, _fetch_one_sync, symbol)
            return symbol, data

        # Batch in groups of 10 to avoid rate limits
        results = {}
        for i in range(0, len(tickers), 10):
            batch = tickers[i:i + 10]
            batch_results = await asyncio.gather(
                *[fetch_one(t) for t in batch],
                return_exceptions=True,
            )
            for item in batch_results:
                if isinstance(item, Exception):
                    continue
                symbol, data = item
                if data:
                    results[symbol] = data
            if i + 10 < len(tickers):
                await asyncio.sleep(2)

        executor.shutdown(wait=False)

        # If Yahoo returned too few results, fall back to demo mode
        if len(results) < len(tickers) * 0.3:
            print(f"Yahoo returned {len(results)}/{len(tickers)} tickers, falling back to demo data")
            return self._fetch_demo(tickers)

        return results

    def _fetch_demo(self, tickers: list[str]) -> dict[str, dict]:
        return {
            t: _generate_demo_data(t, hash(t) % 10000)
            for t in tickers
        }
