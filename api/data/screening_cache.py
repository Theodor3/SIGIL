"""Screening-fundamentals cache — spreads FMP's daily quota across runs.

Coverage compounds: each run refreshes missing tickers first (shuffled, so
no alphabetical bias), then the stalest cached entries. Stale data is still
used for screening — quarterly fundamentals age well, and stale beats absent.
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import ScreeningCache

STALE_AFTER_DAYS = 14
# Per-run refresh budget in tickers (3 FMP calls each). Sized for FMP
# Starter's 300/min limit with the global pacer: 500 tickers ≈ 1,500 calls
# ≈ 5.5 min per run, full ~3,200-ticker coverage in ~7 runs (<2 days),
# then steady-state re-refresh every 14 days fits inside one run's budget.
REFRESH_BUDGET = 500


async def load_screening_cache(db: AsyncSession) -> dict[str, dict]:
    """{ticker: {"data": ..., "fetched_at": ...}} for all cached tickers."""
    rows = await db.execute(select(ScreeningCache))
    return {
        r.ticker: {"data": r.data, "fetched_at": r.fetched_at}
        for r in rows.scalars().all()
        if r.data
    }


def choose_refresh(
    universe: list[str],
    cached: dict[str, dict],
    budget: int = REFRESH_BUDGET,
) -> list[str]:
    """Pick which tickers to spend this run's FMP quota on."""
    missing = [t for t in universe if t not in cached]
    random.shuffle(missing)
    if len(missing) >= budget:
        return missing[:budget]

    stale_cutoff = datetime.utcnow() - timedelta(days=STALE_AFTER_DAYS)
    stale = sorted(
        (t for t in universe if t in cached and cached[t]["fetched_at"] < stale_cutoff),
        key=lambda t: cached[t]["fetched_at"],
    )
    return missing + stale[: budget - len(missing)]


async def store_screening_cache(db: AsyncSession, fresh: dict[str, dict]) -> None:
    """Upsert freshly fetched screening data."""
    if not fresh:
        return
    now = datetime.utcnow()
    for ticker, data in fresh.items():
        row = await db.get(ScreeningCache, ticker)
        if row is None:
            db.add(ScreeningCache(ticker=ticker, data=data, fetched_at=now))
        else:
            row.data = data
            row.fetched_at = now
    await db.commit()
