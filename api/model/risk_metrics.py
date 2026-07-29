"""Risk-adjusted return metrics from the equity snapshot record.

Sharpe and Sortino are derived at read time from equity_snapshots, never
stored — same rule as returns and drawdowns.

Two things this module is deliberately strict about:

Weekends are dropped. The snapshot job keeps writing hourly through Saturday
and Sunday, but a carried-forward equity value is not a return. Leaving those
rows in adds fake zero-return observations, which drags the mean down faster
than it drags the standard deviation, understating Sharpe.

Below MIN_DAILY_RETURNS observations the annualised figure is suppressed
rather than reported. Annualising multiplies by sqrt(252), which scales the
sampling noise along with the signal: at ~14 daily returns the standard error
on an annualised Sharpe is about +/-4, so a "1.2" is indistinguishable from
zero or from five. The caller gets n and the threshold so it can show progress
toward a number worth reading instead of a number that looks authoritative.
"""
from __future__ import annotations

import math
from datetime import date, datetime

TRADING_DAYS = 252

# Roughly a quarter of daily observations. At n=60 the standard error on an
# annualised Sharpe is ~0.65 — still wide, but no longer meaningless.
MIN_DAILY_RETURNS = 60

# 3-month T-bill, fetched from FRED. Used when FRED is unreachable or no API
# key is configured; rf_source reports which one was actually applied.
DEFAULT_RF_ANNUAL = 0.04
_RF_CACHE_KEY = "risk_metrics:rf_annual"
_RF_CACHE_TTL = 43_200  # 12h — this series moves slowly


def daily_closes(rows) -> list[tuple[date, float]]:
    """Last equity observation of each trading day, oldest first.

    `rows` is any iterable of objects with `taken_at` and `equity`.
    """
    by_day: dict[date, tuple[datetime, float]] = {}
    for r in rows:
        d = r.taken_at.date()
        if d.weekday() >= 5:  # carried-forward weekend row, not a return
            continue
        prev = by_day.get(d)
        if prev is None or r.taken_at >= prev[0]:
            by_day[d] = (r.taken_at, r.equity)
    return [(d, by_day[d][1]) for d in sorted(by_day)]


def _stdev(xs: list[float]) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def _downside_dev(xs: list[float], mar: float) -> float:
    """Target semi-deviation: RMS shortfall below `mar` over ALL observations.

    Dividing by the full count rather than only the losing days is the
    convention that keeps Sortino comparable to Sharpe.
    """
    if not xs:
        return 0.0
    return math.sqrt(sum(min(x - mar, 0.0) ** 2 for x in xs) / len(xs))


async def risk_free_annual() -> tuple[float, str]:
    """Annualised risk-free rate as a decimal, plus its source.

    Returns (rate, "fred:DGS3MO" | "default").
    """
    from api import cache as app_cache

    cached = app_cache.get(_RF_CACHE_KEY)
    if cached is not None:
        return cached

    from api.config.settings import settings

    if settings.fred_api_key:
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://api.stlouisfed.org/fred/series/observations",
                    params={
                        "series_id": "DGS3MO",
                        "api_key": settings.fred_api_key,
                        "file_type": "json",
                        "sort_order": "desc",
                        "limit": 10,
                    },
                )
            if resp.status_code == 200:
                for obs in resp.json().get("observations", []):
                    val = obs.get("value", ".")
                    if val != ".":
                        result = (float(val) / 100.0, "fred:DGS3MO")
                        app_cache.set(_RF_CACHE_KEY, result, ttl=_RF_CACHE_TTL)
                        return result
        except Exception as e:
            print(f"[risk_metrics] FRED risk-free lookup failed: {e}")

    result = (DEFAULT_RF_ANNUAL, "default")
    # Short TTL on the fallback so a transient FRED outage doesn't pin it for 12h
    app_cache.set(_RF_CACHE_KEY, result, ttl=900)
    return result


def compute(closes: list[tuple[date, float]], rf_annual: float, rf_source: str) -> dict:
    """Sharpe and Sortino over the supplied daily closes.

    Both are None when the sample is too small to annualise, when equity never
    moved, or (Sortino) when nothing ever fell below the risk-free rate.
    """
    equity = [e for _, e in closes]
    returns = [
        equity[i] / equity[i - 1] - 1
        for i in range(1, len(equity))
        if equity[i - 1]
    ]
    n = len(returns)

    out: dict = {
        "sharpe": None,
        "sortino": None,
        "n_daily_returns": n,
        "min_daily_returns": MIN_DAILY_RETURNS,
        "sufficient": n >= MIN_DAILY_RETURNS,
        "rf_annual": round(rf_annual, 4),
        "rf_source": rf_source,
        "annualized_vol": None,
        "downside_deviation": None,
        "standard_error": None,
        "first_day": closes[0][0].isoformat() if closes else None,
        "last_day": closes[-1][0].isoformat() if closes else None,
    }
    if n < 2:
        return out

    rf_daily = (1 + rf_annual) ** (1 / TRADING_DAYS) - 1
    mean_d = sum(returns) / n
    sd_d = _stdev(returns)
    dd_d = _downside_dev(returns, rf_daily)
    root = math.sqrt(TRADING_DAYS)

    out["annualized_vol"] = round(sd_d * root, 4)
    out["downside_deviation"] = round(dd_d * root, 4)

    # Zero variance means the account never moved — no risk-adjusted reading
    # exists. Bail before Sortino, which would otherwise report a confident
    # -sqrt(252) purely because a flat return sits below the risk-free rate.
    if sd_d <= 0:
        return out

    sr_daily = (mean_d - rf_daily) / sd_d
    # Lo (2002), iid case: SE(SR_annual) = sqrt((1 + SR_d^2/2)/n) * sqrt(252)
    out["standard_error"] = round(math.sqrt((1 + sr_daily ** 2 / 2) / n) * root, 3)

    # Report the estimate only once the sample can support it
    if not out["sufficient"]:
        return out
    out["sharpe"] = round(sr_daily * root, 3)
    if dd_d > 0:
        out["sortino"] = round((mean_d - rf_daily) / dd_d * root, 3)
    return out
