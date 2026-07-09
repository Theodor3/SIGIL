"""Execution-cost tracking — the churn tax meter.

Records every rebalancer order alongside the planning quote it was priced
against, reconciles fills from the broker, and aggregates slippage. This is
the meter that would have caught the July 8 open (an $8.9k round-trip spread
bill) the hour it happened instead of a day later by hand.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import OrderExecution

TERMINAL_STATUSES = {"filled", "canceled", "cancelled", "expired", "rejected"}
# Stop chasing fills for orders older than this — DAY orders are long dead
RECONCILE_WINDOW_DAYS = 7


def slippage_bps(side: str, planning_price: float | None, filled_price: float | None) -> float | None:
    """Signed slippage in basis points; positive always means cost."""
    if not planning_price or not filled_price or planning_price <= 0:
        return None
    if side == "buy":
        return (filled_price - planning_price) / planning_price * 10_000
    return (planning_price - filled_price) / planning_price * 10_000


def record_order(
    db: AsyncSession,
    *,
    order_id: str,
    ticker: str,
    side: str,
    shares: int,
    reason: str | None,
    planning_price: float | None,
    limit_price: float | None,
    status: str,
    filled_price: float | None,
) -> None:
    """Stage an execution record for a just-submitted order (caller commits)."""
    filled = filled_price if filled_price else None
    db.add(OrderExecution(
        order_id=order_id,
        submitted_at=datetime.utcnow(),
        ticker=ticker,
        side=side,
        shares=shares,
        reason=reason,
        planning_price=planning_price,
        limit_price=limit_price,
        status=status or "submitted",
        filled_qty=float(shares) if filled else None,
        filled_price=filled,
        slippage_bps=slippage_bps(side, planning_price, filled),
    ))


async def reconcile_executions(db: AsyncSession, broker) -> dict:
    """Backfill fill prices for orders that weren't filled at submit time."""
    cutoff = datetime.utcnow() - timedelta(days=RECONCILE_WINDOW_DAYS)
    open_q = await db.execute(
        select(OrderExecution)
        .where(OrderExecution.filled_price.is_(None))
        .where(~OrderExecution.status.in_(TERMINAL_STATUSES))
        .where(OrderExecution.submitted_at >= cutoff)
        .limit(200)
    )
    pending = open_q.scalars().all()
    if not pending:
        return {"reconciled": 0, "still_open": 0}

    reconciled = still_open = 0
    for rec in pending:
        info = await broker.get_order_fill(rec.order_id)
        if info is None:
            still_open += 1
            continue
        rec.status = info["status"]
        if info["filled_price"]:
            rec.filled_price = info["filled_price"]
            rec.filled_qty = info["filled_qty"] or rec.shares
            rec.slippage_bps = slippage_bps(rec.side, rec.planning_price, rec.filled_price)
            reconciled += 1
        elif info["status"] not in TERMINAL_STATUSES:
            still_open += 1

    await db.commit()
    return {"reconciled": reconciled, "still_open": still_open}


async def execution_quality(db: AsyncSession, days: int = 30) -> dict:
    """Aggregate slippage stats: cumulative and per-day."""
    since = datetime.utcnow() - timedelta(days=days)
    rows_q = await db.execute(
        select(OrderExecution).where(OrderExecution.submitted_at >= since)
    )
    rows = rows_q.scalars().all()

    def _aggregate(records) -> dict:
        filled = [r for r in records if r.filled_price and r.planning_price]
        notional = sum(r.filled_price * (r.filled_qty or r.shares) for r in filled)
        cost = sum(
            (r.slippage_bps or 0) / 10_000 * r.planning_price * (r.filled_qty or r.shares)
            for r in filled
        )
        weighted_bps = (cost / notional * 10_000) if notional else 0.0
        return {
            "orders": len(records),
            "filled": len(filled),
            "unfilled": sum(1 for r in records if not r.filled_price),
            "traded_notional": round(notional, 2),
            "cost_dollars": round(cost, 2),
            "avg_slippage_bps": round(weighted_bps, 2),
        }

    by_day: dict[str, list] = {}
    for r in rows:
        by_day.setdefault(r.submitted_at.date().isoformat(), []).append(r)

    return {
        "window_days": days,
        "cumulative": _aggregate(rows),
        "by_day": [
            {"date": day, **_aggregate(records)}
            for day, records in sorted(by_day.items(), reverse=True)
        ],
    }
