"""Financial Modeling Prep data provider — cleaner fundamentals than Yahoo."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_BASE = "https://financialmodelingprep.com/stable"


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


# Global pacer: FMP Starter allows 300 calls/min. Un-paced batch blasts
# (20 tickers x 3 calls with 0.3s sleeps) hit the wall inside a minute and
# drown in 429s — which looked like a dead quota. ~270/min leaves headroom.
_CALLS_PER_SECOND = 4.5
_pace_lock = asyncio.Lock()
_next_slot = 0.0


async def _throttle() -> None:
    global _next_slot
    loop = asyncio.get_running_loop()
    async with _pace_lock:
        now = loop.time()
        wait = max(0.0, _next_slot - now)
        _next_slot = max(now, _next_slot) + 1.0 / _CALLS_PER_SECOND
    if wait > 0:
        await asyncio.sleep(wait)


async def _get(client: httpx.AsyncClient, endpoint: str, params: dict | None = None) -> Any:
    params = params or {}
    params["apikey"] = settings.fmp_api_key
    await _throttle()
    resp = await client.get(f"{_BASE}/{endpoint}", params=params)
    if resp.status_code == 429:
        await asyncio.sleep(5)
        await _throttle()
        resp = await client.get(f"{_BASE}/{endpoint}", params=params)
    if resp.status_code != 200:
        return None
    return resp.json()


def _cagr(recent: float, old: float, years: int) -> float | None:
    """Compute compound annual growth rate. Returns None if inputs are invalid."""
    if years <= 0 or old <= 0 or recent <= 0:
        return None
    return (recent / old) ** (1.0 / years) - 1.0


def _compute_cagrs(income_data: list, cashflow_data_hist: list) -> tuple[float, float]:
    """Compute 3Y revenue and FCF CAGRs from annual financial statements."""
    rev_cagr = 0.0
    fcf_cagr = 0.0

    if len(income_data) >= 2:
        revs = [_num(d.get("revenue")) for d in income_data]
        revs = [r for r in revs if r and r > 0]
        if len(revs) >= 2:
            years = min(len(revs) - 1, 3)
            c = _cagr(revs[0], revs[years], years)
            if c is not None:
                rev_cagr = c

    if len(cashflow_data_hist) >= 2:
        fcfs = [_num(d.get("freeCashFlow")) for d in cashflow_data_hist]
        fcfs = [f for f in fcfs if f and f > 0]
        if len(fcfs) >= 2:
            years = min(len(fcfs) - 1, 3)
            c = _cagr(fcfs[0], fcfs[years], years)
            if c is not None:
                fcf_cagr = c

    return rev_cagr, fcf_cagr


async def _fetch_ticker(client: httpx.AsyncClient, symbol: str) -> dict | None:
    """Fetch profile + key metrics + ratios + historical financials for one ticker."""
    profile_data, metrics_data, ratios_data, cashflow_data, income_data = await asyncio.gather(
        _get(client, "profile", {"symbol": symbol}),
        _get(client, "key-metrics-ttm", {"symbol": symbol}),
        _get(client, "ratios-ttm", {"symbol": symbol}),
        _get(client, "cash-flow-statement", {"symbol": symbol, "limit": "4"}),
        _get(client, "income-statement", {"symbol": symbol, "limit": "4"}),
        return_exceptions=True,
    )

    profile = {}
    if isinstance(profile_data, list) and profile_data:
        profile = profile_data[0]
    elif isinstance(profile_data, dict):
        profile = profile_data

    if not profile.get("symbol"):
        return None

    metrics = {}
    if isinstance(metrics_data, list) and metrics_data:
        metrics = metrics_data[0]

    ratios = {}
    if isinstance(ratios_data, list) and ratios_data:
        ratios = ratios_data[0]

    cf_list = cashflow_data if isinstance(cashflow_data, list) else []
    cf = cf_list[0] if cf_list else {}

    income_list = income_data if isinstance(income_data, list) else []

    market_cap = _num(profile.get("marketCap")) or _num(metrics.get("marketCap"))
    ebitda_ev = _num(metrics.get("evToEBITDATTM"))
    ev = _num(metrics.get("enterpriseValueTTM"))
    net_debt_ebitda = _num(metrics.get("netDebtToEBITDATTM"))

    roic = _num(metrics.get("returnOnInvestedCapitalTTM"))
    roe = _num(metrics.get("returnOnEquityTTM")) or _num(ratios.get("returnOnEquityTTM"))
    roa = _num(metrics.get("returnOnAssetsTTM")) or _num(ratios.get("returnOnAssetsTTM"))

    revenue_per_share = _num(ratios.get("revenuePerShareTTM"))
    fcf_per_share = _num(ratios.get("freeCashFlowPerShareTTM"))
    fcf_margin = None
    if fcf_per_share and revenue_per_share and revenue_per_share > 0:
        fcf_margin = fcf_per_share / revenue_per_share

    buyback_ttm = abs(_num(cf.get("commonStockRepurchased")) or 0)

    rev_cagr, fcf_cagr = _compute_cagrs(income_list, cf_list)

    return {
        "roic": roic or (roa or 0),
        "fcf_margin": fcf_margin or 0,
        "asset_turnover": _num(ratios.get("assetTurnoverTTM")) or 0,
        "revenue_cagr_3y": rev_cagr,
        "fcf_cagr_3y": fcf_cagr,
        "debt_to_ebitda": net_debt_ebitda,
        "total_debt": _num(metrics.get("totalDebtTTM")) or 0,
        "total_equity": _num(metrics.get("bookValueTTM")) or 0,
        "debt_to_equity": _num(ratios.get("debtEquityRatioTTM")),
        "interest_coverage": _num(ratios.get("interestCoverageRatioTTM")),
        "market_cap": market_cap,
        "sector": profile.get("sector", ""),
        "industry": profile.get("industry", ""),
        "description": (profile.get("description") or "")[:500],
        "trailing_pe": _num(ratios.get("priceToEarningsRatioTTM")),
        "forward_pe": _num(ratios.get("priceToEarningsGrowthRatioTTM")),
        "price_to_sales": _num(ratios.get("priceToSalesRatioTTM")),
        "ev_to_ebitda": _num(ratios.get("enterpriseValueMultipleTTM")),
        "ev_to_revenue": _num(metrics.get("evToSalesTTM")),
        "dividend_yield": _num(ratios.get("dividendYieldTTM")),
        "payout_ratio": _num(ratios.get("dividendPayoutRatioTTM")),
        "short_ratio": None,
        "short_pct_float": None,
        "shares_outstanding": None,
        "buyback_ttm": buyback_ttm,
        "roe": roe,
        "roa": roa,
        "operating_margin": _num(ratios.get("operatingProfitMarginTTM")),
        "net_margin": _num(ratios.get("netProfitMarginTTM")),
        "current_ratio": _num(ratios.get("currentRatioTTM")),
        "_source": "fmp",
    }


async def _fetch_screening_data(client: httpx.AsyncClient, symbol: str) -> dict | None:
    """Lightweight fetch for screening — profile + key-metrics-ttm + ratios-ttm (3 calls instead of 4)."""
    profile_data, metrics_data, ratios_data = await asyncio.gather(
        _get(client, "profile", {"symbol": symbol}),
        _get(client, "key-metrics-ttm", {"symbol": symbol}),
        _get(client, "ratios-ttm", {"symbol": symbol}),
        return_exceptions=True,
    )

    profile = {}
    if isinstance(profile_data, list) and profile_data:
        profile = profile_data[0]
    elif isinstance(profile_data, dict):
        profile = profile_data

    if not profile.get("symbol"):
        return None

    metrics = {}
    if isinstance(metrics_data, list) and metrics_data:
        metrics = metrics_data[0]

    ratios = {}
    if isinstance(ratios_data, list) and ratios_data:
        ratios = ratios_data[0]

    fcf_margin = 0.0
    rev = _num(ratios.get("revenuePerShareTTM"))
    fcf = _num(ratios.get("freeCashFlowPerShareTTM"))
    if rev and fcf and rev > 0:
        fcf_margin = fcf / rev

    return {
        "roic": _num(metrics.get("returnOnInvestedCapitalTTM")) or _num(metrics.get("returnOnAssetsTTM")) or 0,
        "fcf_margin": fcf_margin,
        "asset_turnover": _num(ratios.get("assetTurnoverTTM")) or 0,
        "debt_to_ebitda": _num(metrics.get("netDebtToEBITDATTM")),
        "market_cap": _num(profile.get("marketCap")) or _num(metrics.get("marketCap")),
        "sector": profile.get("sector", ""),
        "industry": profile.get("industry", ""),
        "_source": "fmp_screen",
    }


class FMPProvider(DataProvider):
    @property
    def name(self) -> str:
        return "fmp"

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        if not settings.fmp_api_key:
            return {}

        results: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(tickers), 10):
                batch = tickers[i:i + 10]
                tasks = [_fetch_ticker(client, t) for t in batch]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception):
                        print(f"[fmp] {ticker} failed: {result}")
                        continue
                    if result:
                        results[ticker] = result
                if i + 10 < len(tickers):
                    await asyncio.sleep(0.3)

        return results

    async def fetch_price_targets(self, tickers: list[str]) -> dict[str, dict]:
        """Fetch analyst consensus price targets."""
        if not settings.fmp_api_key:
            return {}

        results: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(tickers), 15):
                batch = tickers[i:i + 15]
                tasks = [
                    _get(client, "price-target-consensus", {"symbol": t})
                    for t in batch
                ]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception) or not result:
                        continue
                    row = result[0] if isinstance(result, list) and result else result
                    if isinstance(row, dict) and row.get("targetConsensus"):
                        results[ticker] = {
                            "targetConsensus": _num(row.get("targetConsensus")),
                            "targetMedian": _num(row.get("targetMedian")),
                            "targetHigh": _num(row.get("targetHigh")),
                            "targetLow": _num(row.get("targetLow")),
                            "numberOfAnalysts": row.get("numberOfAnalysts", 0),
                        }
                if i + 15 < len(tickers):
                    await asyncio.sleep(0.3)

        return results

    async def fetch_shares_float(self, tickers: list[str]) -> dict[str, dict]:
        """Fetch shares float data for short interest calculations."""
        if not settings.fmp_api_key:
            return {}

        results: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(tickers), 15):
                batch = tickers[i:i + 15]
                tasks = [
                    _get(client, "shares-float", {"symbol": t})
                    for t in batch
                ]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception) or not result:
                        continue
                    row = result[0] if isinstance(result, list) and result else result
                    if isinstance(row, dict) and row.get("floatShares"):
                        results[ticker] = {
                            "float_shares": _num(row.get("floatShares")),
                            "outstanding_shares": _num(row.get("outstandingShares")),
                            "free_float_pct": _num(row.get("freeFloat")),
                        }
                if i + 15 < len(tickers):
                    await asyncio.sleep(0.3)

        return results

    async def fetch_analyst_estimates(self, tickers: list[str]) -> dict[str, dict]:
        """Fetch forward analyst estimates for revenue and EPS."""
        if not settings.fmp_api_key:
            return {}

        results: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(tickers), 15):
                batch = tickers[i:i + 15]
                tasks = [
                    _get(client, "analyst-estimates", {"symbol": t, "period": "annual", "limit": "2"})
                    for t in batch
                ]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception) or not result:
                        continue
                    if isinstance(result, list) and result:
                        est = result[0]
                        results[ticker] = {
                            "estimated_revenue_avg": _num(est.get("revenueAvg")),
                            "estimated_revenue_low": _num(est.get("revenueLow")),
                            "estimated_revenue_high": _num(est.get("revenueHigh")),
                            "estimated_eps_avg": _num(est.get("epsAvg")),
                            "estimated_eps_low": _num(est.get("epsLow")),
                            "estimated_eps_high": _num(est.get("epsHigh")),
                            "estimated_net_income_avg": _num(est.get("netIncomeAvg")),
                            "number_analysts_revenue": est.get("numAnalystsRevenue", 0),
                            "number_analysts_eps": est.get("numAnalystsEps", 0),
                        }
                if i + 15 < len(tickers):
                    await asyncio.sleep(0.3)

        return results

    async def fetch_screening_data(self, tickers: list[str]) -> dict[str, dict]:
        """Lightweight fundamentals for screening — 3 API calls per ticker.

        Bails after consecutive all-empty batches: once the free-tier daily
        quota is spent every call fails, and grinding through the rest of the
        list wastes minutes of pipeline time for nothing."""
        if not settings.fmp_api_key:
            return {}

        results: dict[str, dict] = {}
        empty_batches = 0
        async with httpx.AsyncClient(timeout=30) as client:
            for i in range(0, len(tickers), 20):
                batch = tickers[i:i + 20]
                tasks = [_fetch_screening_data(client, t) for t in batch]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                batch_hits = 0
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception):
                        continue
                    if result:
                        results[ticker] = result
                        batch_hits += 1
                if batch_hits == 0:
                    empty_batches += 1
                    if empty_batches >= 3:
                        print(f"[fmp] Screening fetch bailed at {i + len(batch)}/{len(tickers)} — quota likely exhausted")
                        break
                else:
                    empty_batches = 0
                if i + 20 < len(tickers):
                    await asyncio.sleep(0.3)

        return results
