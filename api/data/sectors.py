"""Sector lookup for the portfolio — reads persisted data, not a request cache.

Sector is the input to the sector concentration cap, so it has to survive between
pipeline runs. It used to be read from the in-process TTL cache, which the pipeline
writes with a 10-minute TTL for the top 30 names to warm the Research page. With
runs hours apart, every lookup outside that window missed and the entire book
resolved to UNCLASSIFIED_SECTOR — a 30% cap on data that was absent 99% of the time.

The durable home already existed: screening_cache holds sector and industry per
ticker, on disk, for the whole screened universe. The pipeline refreshes a slice of
it every run, nothing prunes it, and it is the same payload every sector-relative
signal (value, peer_relative, forward_value) already scores against. A second copy
of the same field would only add a way for the two to disagree.

Call sites pass position- or target-sized ticker lists (tens, not thousands).
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config.settings import settings
from api.db.models import ScreeningCache


async def load_sector_map(db: AsyncSession, tickers: list[str]) -> dict[str, str]:
    """{ticker: sector} for the tickers that have one on file.

    Tickers with no sector are simply absent, so callers keep applying their own
    UNCLASSIFIED_SECTOR fallback — a miss must never be reported as a real sector.
    """
    wanted = list(dict.fromkeys(tickers))
    if not wanted:
        return {}

    rows = await db.execute(
        select(ScreeningCache).where(ScreeningCache.ticker.in_(wanted))
    )
    resolved: dict[str, str] = {}
    for row in rows.scalars().all():
        sector = ((row.data or {}).get("sector") or "").strip()
        if sector:
            resolved[row.ticker] = sector

    # Second source for anything the screening cache doesn't cover — a held name
    # that has since left the universe, say. The Research page writes company info
    # per ticker on demand, so it is sometimes populated when the table isn't.
    missing = [t for t in wanted if t not in resolved]
    if missing:
        from api import cache as app_cache
        for ticker in missing:
            cached = app_cache.get(f"company:{ticker}") or {}
            sector = (cached.get("sector") or "").strip()
            if sector:
                resolved[ticker] = sector

    return resolved


async def sectors_for_construction(
    db: AsyncSession, tickers: list[str]
) -> dict[str, str]:
    """Sector map as the portfolio constructor should see it, gated by a setting.

    Populating sector data and letting it change orders are deliberately two
    separate switches. The 30% sector cap has never bound in practice — the data it
    needed was missing — so the first run with real sectors would re-cut a live book
    on constraints that have never been exercised. With enforce_sector_cap off,
    every candidate resolves to UNCLASSIFIED_SECTOR and construction behaves exactly
    as it does today; reporting and GET /api/portfolio/sector-preview still show the
    real sectors, which is how you check the spread before flipping it on.
    """
    if not settings.enforce_sector_cap:
        return {}
    return await load_sector_map(db, tickers)
