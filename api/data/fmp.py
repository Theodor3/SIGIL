"""Financial Modeling Prep data provider — cleaner fundamentals than Yahoo."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_BASE = "https://financialmodelingprep.com/api/v3"


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f
    except (TypeError, ValueError):
        return None


async def _get(client: httpx.AsyncClient, path: str, params: dict | None = None) -> Any:
    params = params or {}
    params["apikey"] = settings.fmp_api_key
    resp = await client.get(f"{_BASE}{path}", params=params)
    if resp.status_code == 429:
        await asyncio.sleep(2)
        resp = await client.get(f"{_BASE}{path}", params=params)
    if resp.status_code != 200:
        return None
    return resp.json()


async def _fetch_ticker(client: httpx.AsyncClient, symbol: str) -> dict | None:
    """Fetch profile + key metrics + ratios for one ticker."""
    profile_data, metrics_data, ratios_data, cashflow_data = await asyncio.gather(
        _get(client, f"/profile/{symbol}"),
        _get(client, f"/key-metrics-ttm/{symbol}"),
        _get(client, f"/ratios-ttm/{symbol}"),
        _get(client, f"/cash-flow-statement/{symbol}", {"limit": "1"}),
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

    cf = {}
    if isinstance(cashflow_data, list) and cashflow_data:
        cf = cashflow_data[0]

    market_cap = _num(profile.get("mktCap"))
    total_debt = _num(metrics.get("totalDebtTTM"))
    ebitda = _num(metrics.get("ebitdaTTM"))
    total_equity = _num(metrics.get("bookValuePerShareTTM"))
    shares = _num(profile.get("volAvg"))  # fallback
    shares_out = _num(metrics.get("marketCapTTM"))
    if total_equity and market_cap:
        pe = _num(metrics.get("peRatioTTM"))
        if pe and pe > 0:
            eps = _num(metrics.get("netIncomePerShareTTM"))
            if eps:
                shares_out_calc = market_cap / (eps * pe) if eps * pe != 0 else None
                if shares_out_calc and total_equity:
                    total_equity = total_equity * shares_out_calc

    revenue = _num(metrics.get("revenueTTM")) or _num(metrics.get("revenuePerShareTTM"))
    fcf = _num(metrics.get("freeCashFlowTTM"))
    fcf_margin = None
    if fcf and revenue and revenue > 0:
        fcf_margin = fcf / revenue

    roic = _num(metrics.get("roicTTM"))
    roe = _num(ratios.get("returnOnEquityTTM"))
    roa = _num(ratios.get("returnOnAssetsTTM"))

    debt_to_ebitda = None
    if total_debt and ebitda and ebitda > 0:
        debt_to_ebitda = total_debt / ebitda

    buyback_ttm = abs(_num(cf.get("commonStockRepurchased")) or 0)

    rev_growth = _num(metrics.get("revenueGrowthTTM")) or _num(ratios.get("revenueGrowthTTM"))

    return {
        "roic": roic or (roa or 0),
        "fcf_margin": fcf_margin or 0,
        "asset_turnover": _num(ratios.get("assetTurnoverTTM")) or 0,
        "revenue_cagr_3y": rev_growth or 0,
        "fcf_cagr_3y": 0,
        "debt_to_ebitda": debt_to_ebitda,
        "total_debt": total_debt or 0,
        "total_equity": _num(metrics.get("bookValuePerShareTTM")) or 0,
        "market_cap": market_cap,
        "sector": profile.get("sector", ""),
        "industry": profile.get("industry", ""),
        "description": (profile.get("description") or "")[:500],
        "trailing_pe": _num(ratios.get("priceEarningsRatioTTM")),
        "forward_pe": _num(ratios.get("priceEarningsToGrowthRatioTTM")),
        "price_to_sales": _num(ratios.get("priceToSalesRatioTTM")),
        "ev_to_ebitda": _num(ratios.get("enterpriseValueOverEBITDATTM")),
        "ev_to_revenue": _num(metrics.get("enterpriseValueOverRevenueTTM")),
        "dividend_yield": _num(ratios.get("dividendYielTTM")),
        "payout_ratio": _num(ratios.get("payoutRatioTTM")),
        "short_ratio": None,
        "short_pct_float": None,
        "shares_outstanding": _num(profile.get("volAvg")),
        "buyback_ttm": buyback_ttm,
        # FMP extras not in Yahoo
        "roe": roe,
        "roa": roa,
        "operating_margin": _num(ratios.get("operatingProfitMarginTTM")),
        "net_margin": _num(ratios.get("netProfitMarginTTM")),
        "current_ratio": _num(ratios.get("currentRatioTTM")),
        "interest_coverage": _num(ratios.get("interestCoverageTTM")),
        "_source": "fmp",
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
            # Batch in groups of 5 to stay within rate limits (250/day free tier)
            for i in range(0, len(tickers), 5):
                batch = tickers[i:i + 5]
                tasks = [_fetch_ticker(client, t) for t in batch]
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for ticker, result in zip(batch, batch_results):
                    if isinstance(result, Exception):
                        print(f"[fmp] {ticker} failed: {result}")
                        continue
                    if result:
                        results[ticker] = result
                if i + 5 < len(tickers):
                    await asyncio.sleep(0.5)

        return results
