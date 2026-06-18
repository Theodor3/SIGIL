"""Yahoo Finance data provider — fundamentals + price data via yfinance."""
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

        # Buyback data from cashflow statement
        buyback_ttm = 0.0
        try:
            cf = t.cashflow
            if cf is not None and not cf.empty:
                for label in ("Repurchase Of Capital Stock", "RepurchaseOfCapitalStock"):
                    if label in cf.index:
                        val = cf.loc[label].iloc[0]
                        buyback_ttm = float(val) if val is not None and val == val else 0.0
                        break
        except Exception:
            pass

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
            "description": (info.get("longBusinessSummary") or "")[:500],
            "trailing_pe": _num(info.get("trailingPE")),
            "forward_pe": _num(info.get("forwardPE")),
            "price_to_sales": _num(info.get("priceToSalesTrailing12Months")),
            "ev_to_ebitda": _num(info.get("enterpriseToEbitda")),
            "ev_to_revenue": _num(info.get("enterpriseToRevenue")),
            "dividend_yield": _num(info.get("dividendYield")),
            "payout_ratio": _num(info.get("payoutRatio")),
            "short_ratio": _num(info.get("shortRatio")),
            "short_pct_float": _num(info.get("shortPercentOfFloat")),
            "shares_outstanding": _num(info.get("sharesOutstanding")),
            "buyback_ttm": buyback_ttm,
        }
    except Exception:
        return None


def _fetch_prices_batch_sync(tickers: list[str]) -> dict[str, dict]:
    """Batch-download 35 days of price data for all tickers in ONE yfinance call."""
    import yfinance as yf
    try:
        df = yf.download(tickers, period="35d", group_by="ticker", progress=False, threads=True)
        if df.empty:
            return {}
    except Exception as e:
        print(f"[yahoo] Batch price download failed: {e}")
        return {}

    market_data: dict[str, dict] = {}

    for ticker in tickers:
        try:
            if len(tickers) == 1:
                tdf = df
            else:
                tdf = df[ticker] if ticker in df.columns.get_level_values(0) else None
            if tdf is None or tdf.empty:
                continue

            tdf = tdf.dropna(subset=["Close"])
            if len(tdf) < 5:
                continue

            closes = tdf["Close"].values.tolist()
            volumes = tdf["Volume"].values.tolist()
            highs = tdf["High"].values.tolist()
            lows = tdf["Low"].values.tolist()

            current = closes[-1]
            close_5d_ago = closes[-6] if len(closes) >= 6 else closes[0]
            close_20d_ago = closes[0] if len(closes) >= 15 else closes[0]

            ret_5d = (current - close_5d_ago) / close_5d_ago if close_5d_ago else 0
            ret_20d = (current - close_20d_ago) / close_20d_ago if close_20d_ago else 0

            avg_vol_20d = sum(volumes[-20:]) / max(len(volumes[-20:]), 1)
            recent_vol = volumes[-1] if volumes else 0
            vol_ratio = recent_vol / avg_vol_20d if avg_vol_20d > 0 else 1.0

            if len(closes) >= 5:
                daily_returns = [(closes[j] - closes[j-1]) / closes[j-1] for j in range(1, len(closes)) if closes[j-1] != 0]
                if daily_returns:
                    mean_ret = sum(daily_returns) / len(daily_returns)
                    variance = sum((r - mean_ret) ** 2 for r in daily_returns) / len(daily_returns)
                    realized_vol = (variance ** 0.5) * (252 ** 0.5)
                else:
                    realized_vol = 0
            else:
                realized_vol = 0

            atr_values = [highs[j] - lows[j] for j in range(max(len(highs) - 14, 0), len(highs))]
            atr = sum(atr_values) / max(len(atr_values), 1) if atr_values else 0

            market_data[ticker] = {
                "close": round(float(current), 2),
                "return_5d": round(float(ret_5d), 5),
                "return_20d": round(float(ret_20d), 5),
                "volume": round(float(recent_vol)),
                "avg_volume_20d": round(float(avg_vol_20d)),
                "volume_ratio": round(float(vol_ratio), 3),
                "realized_vol_20d": round(float(realized_vol), 4),
                "atr_14d": round(float(atr), 2),
                "high_20d": round(float(max(highs[-20:])), 2) if highs else float(current),
                "low_20d": round(float(min(lows[-20:])), 2) if lows else float(current),
            }
        except Exception:
            pass

    return market_data


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
        "description": f"A leading {sector.lower()} company.",
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

        if len(results) < len(tickers) * 0.3:
            print(f"Yahoo returned {len(results)}/{len(tickers)} tickers, falling back to demo data")
            return self._fetch_demo(tickers)

        return results

    async def fetch_prices(self, tickers: list[str]) -> dict[str, dict]:
        """Batch-download price data for all tickers in one call. No rate limits."""
        if self._demo_mode:
            return {}
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _fetch_prices_batch_sync, tickers)

    def _fetch_demo(self, tickers: list[str]) -> dict[str, dict]:
        return {
            t: _generate_demo_data(t, hash(t) % 10000)
            for t in tickers
        }
