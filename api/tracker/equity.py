"""Equity snapshot service — the account's honest performance history.

Backfills once from the broker's portfolio-history endpoint (recovering the
weeks before SIGIL recorded its own), then captures an hourly snapshot from
a background task. Skipped entirely in demo mode, where equity is a
constant and the record would be noise.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import EquitySnapshot, RegimeHistory

# Restarts shouldn't double-record: skip capture if the latest snapshot is
# newer than this
MIN_SNAPSHOT_GAP = timedelta(minutes=55)


async def backfill_equity_history(db: AsyncSession, broker) -> dict:
    """One-time: seed the table from broker daily history when empty."""
    if broker.is_demo:
        return {"backfilled": 0, "skipped": "demo mode"}
    existing = await db.execute(select(EquitySnapshot.id).limit(1))
    if existing.scalar_one_or_none() is not None:
        return {"backfilled": 0, "skipped": "already populated"}

    rows = await broker.get_equity_history(period="3M")
    for r in rows:
        db.add(EquitySnapshot(taken_at=r["taken_at"], equity=r["equity"]))
    await db.commit()
    if rows:
        print(f"[equity] Backfilled {len(rows)} daily snapshots from broker history")
    return {"backfilled": len(rows)}


async def capture_snapshot(db: AsyncSession, broker) -> bool:
    """Record current equity; returns True if a row was written."""
    if broker.is_demo:
        return False
    latest = await db.execute(select(func.max(EquitySnapshot.taken_at)))
    last = latest.scalar()
    if last is not None and datetime.utcnow() - last < MIN_SNAPSHOT_GAP:
        return False

    account = await broker.get_account()
    positions = await broker.get_positions()
    regime_q = await db.execute(
        select(RegimeHistory).order_by(RegimeHistory.as_of_date.desc()).limit(1)
    )
    regime = regime_q.scalars().first()

    db.add(EquitySnapshot(
        taken_at=datetime.utcnow(),
        equity=account.equity,
        cash=account.cash,
        positions_count=len(positions),
        regime_id=regime.regime_id if regime else None,
    ))
    await db.commit()
    return True
