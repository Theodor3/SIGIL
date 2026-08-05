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

from api.config.settings import settings
from api.db.models import OrderExecution

TERMINAL_STATUSES = {"filled", "canceled", "cancelled", "expired", "rejected"}
# Stop chasing fills for orders older than this — DAY orders are long dead
RECONCILE_WINDOW_DAYS = 7


def shortfall_bps(side: str, from_price: float | None, to_price: float | None) -> float | None:
    """Signed cost in basis points of moving from one reference price to another.

    Positive always means cost: for a buy, paying more than the reference; for a
    sell, receiving less. Used for both legs of the decomposition -- decision->arrival
    (delay) and arrival->fill (execution) -- so the two are directly additive.
    """
    if not from_price or not to_price or from_price <= 0:
        return None
    if side == "buy":
        return (to_price - from_price) / from_price * 10_000
    return (from_price - to_price) / from_price * 10_000


# Retained under the old name: the legacy column it populates is still reported
# separately, and version 1 rows must stay reproducible.
slippage_bps = shortfall_bps


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
    decision_quote=None,
    arrival_quote=None,
    fill_is_synthetic: bool = False,
) -> None:
    """Stage an execution record for a just-submitted order (caller commits).

    decision_quote is the two-sided quote the rebalance plan was built from;
    arrival_quote is the one taken immediately before the order went out. With both,
    cost splits into delay (market moved before we traded) and execution (how well we
    traded) instead of collapsing into a single figure dominated by the former.
    """
    filled = filled_price if filled_price else None
    d_mid = decision_quote.mid if decision_quote else None
    a_mid = arrival_quote.mid if arrival_quote else None

    # A quote whose spread is implausible for the venue it came from cannot serve as
    # a cost benchmark: the fill is real but the reference is not, so the difference
    # measures the quote's error rather than our execution. Record the fact and leave
    # the bps columns NULL so the aggregates skip the row instead of averaging noise.
    # Each leg is only measurable if the references it spans are both believable.
    # Execution spans arrival -> fill, so it needs the arrival quote. Delay spans
    # decision -> arrival and needs BOTH: gating on arrival alone let an order with a
    # broken decision quote report its delay, which is how 2026-08-04 came out at
    # -333bps -- a 3.3% favourable move in the seconds before submit is quote error,
    # not market movement.
    arrival_bad = bool(arrival_quote is not None and not arrival_quote.is_reliable)
    decision_bad = bool(decision_quote is not None and not decision_quote.is_reliable)
    unreliable = arrival_bad or decision_bad
    feed = (arrival_quote.feed if arrival_quote else None) or (
        decision_quote.feed if decision_quote else None
    )

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
        slippage_bps=shortfall_bps(side, planning_price, filled),
        decision_bid=decision_quote.bid if decision_quote else None,
        decision_ask=decision_quote.ask if decision_quote else None,
        decision_mid=d_mid,
        arrival_bid=arrival_quote.bid if arrival_quote else None,
        arrival_ask=arrival_quote.ask if arrival_quote else None,
        arrival_mid=a_mid,
        arrival_at=(arrival_quote.ts if arrival_quote and arrival_quote.ts
                    else datetime.utcnow()),
        delay_bps=None if unreliable else shortfall_bps(side, d_mid, a_mid),
        # Only meaningful against a real fill and a believable reference: a
        # substituted price would measure a quote against itself, and a broken quote
        # would measure the quote's error.
        execution_bps=(None if (fill_is_synthetic or unreliable)
                       else shortfall_bps(side, a_mid, filled)),
        spread_bps_at_arrival=arrival_quote.spread_bps if arrival_quote else None,
        fill_is_synthetic=bool(fill_is_synthetic),
        measurement_version=2,
        quote_feed=feed,
        quote_unreliable=unreliable,
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
            rec.slippage_bps = shortfall_bps(rec.side, rec.planning_price, rec.filled_price)
            # A real fill arrived, so the execution leg becomes measurable -- unless
            # the arrival quote it would be measured against was never believable.
            rec.execution_bps = (
                None if rec.quote_unreliable
                else shortfall_bps(rec.side, rec.arrival_mid, rec.filled_price)
            )
            rec.fill_is_synthetic = False
            reconciled += 1
        elif info["status"] not in TERMINAL_STATUSES:
            still_open += 1

    await db.commit()
    return {"reconciled": reconciled, "still_open": still_open}


def _is_v2(rec) -> bool:
    """Version 1 rows predate the shortfall columns and were benchmarked against a
    one-sided ask captured at plan time. They are stamped NULL rather than 1 (SQLite
    backfills a DDL default onto existing rows), so NULL means legacy."""
    return (rec.measurement_version or 1) >= 2


def _spread_of(bid, ask) -> float | None:
    if not bid or not ask or bid <= 0 or ask <= 0:
        return None
    mid = (bid + ask) / 2
    return (ask - bid) / mid * 10_000 if mid > 0 else None


def _implausible(spread: float | None) -> bool:
    return bool(spread and spread > settings.implausible_spread_bps)


def _row_unreliable(rec) -> bool:
    """Whether a recorded row's cost figures can be believed.

    Derived at read time rather than trusted from the column, so rows written before
    quote reliability was tracked are judged on the same rule as new ones. Those rows
    carry the quote prices but a NULL quote_unreliable, and several were recorded
    against IEX books quoting over 1000bps on names that trade tens of bps wide --
    reading the column alone would let those keep skewing every aggregate.

    A SIP quote is believed at any width; anything else only inside
    implausible_spread_bps. Checks the ARRIVAL side, which is what the execution leg
    is measured from.
    """
    # getattr throughout: these columns are recent, and a row loaded with a column
    # subset (or any partially-populated object) must not raise inside a read path.
    if getattr(rec, "quote_unreliable", None):
        return True
    if getattr(rec, "quote_feed", None) == "sip":
        return False
    return _implausible(
        getattr(rec, "spread_bps_at_arrival", None)
        or _spread_of(getattr(rec, "arrival_bid", None),
                      getattr(rec, "arrival_ask", None))
    )


def _delay_unreliable(rec) -> bool:
    """Delay spans decision -> arrival, so it needs both references believable.

    Separate from _row_unreliable because the legs have different requirements: an
    order can have a sound arrival quote (measurable execution) and a broken decision
    quote (meaningless delay). Reconstructed from decision_bid/decision_ask, which are
    stored, so historical rows are judged too.
    """
    if _row_unreliable(rec):
        return True
    if getattr(rec, "quote_feed", None) == "sip":
        return False
    return _implausible(_spread_of(getattr(rec, "decision_bid", None),
                                   getattr(rec, "decision_ask", None)))


def _dollar_weighted(records, bps_attr: str, ref_attr: str = "arrival_mid") -> dict:
    """Notional-weighted average of a bps column, plus the dollar total.

    Weighting by traded notional rather than order count keeps one small order from
    carrying the same weight as a large one.
    """
    usable = [
        r for r in records
        if getattr(r, bps_attr) is not None and getattr(r, ref_attr)
    ]
    notional = sum(getattr(r, ref_attr) * (r.filled_qty or r.shares) for r in usable)
    dollars = sum(
        getattr(r, bps_attr) / 10_000 * getattr(r, ref_attr) * (r.filled_qty or r.shares)
        for r in usable
    )
    return {
        "orders": len(usable),
        "bps": round(dollars / notional * 10_000, 2) if notional else None,
        "dollars": round(dollars, 2),
    }


def _aggregate_v2(records) -> dict:
    """Implementation-shortfall decomposition over version 2 rows.

    delay is measured against the decision mid and execution against the arrival
    mid, so each leg is weighted by the reference it is actually measured from.
    Synthetic fills are excluded from the execution leg -- their price came from a
    quote, so measuring it would compare a quote against itself.
    """
    # Rows measured against a quote too far from the real market are dropped from
    # the cost legs entirely -- their bps columns are NULL for new rows, but older
    # rows predate the flag and are caught by _row_unreliable instead.
    measurable = [r for r in records if not _row_unreliable(r)]
    real_fills = [r for r in measurable if r.filled_price and not r.fill_is_synthetic]
    # Delay needs a believable decision quote too, so it filters harder than execution
    delay = _dollar_weighted(
        [r for r in records if not _delay_unreliable(r)], "delay_bps", "decision_mid"
    )
    execution = _dollar_weighted(real_fills, "execution_bps", "arrival_mid")

    # First-order sum. The legs are measured off different references (decision mid
    # vs arrival mid), so an exact decision->fill figure would rescale the execution
    # leg by arrival/decision. That ratio is ~1 for realistic intraday drift, making
    # the correction second-order -- a 50bps move applied to a 5bps execution leg
    # shifts the total by 0.025bps. Not worth the extra column.
    total_bps = None
    if delay["bps"] is not None or execution["bps"] is not None:
        total_bps = round((delay["bps"] or 0.0) + (execution["bps"] or 0.0), 2)

    # Only average spreads we believe. An IEX book sitting far from the consolidated
    # NBBO would otherwise dominate this figure -- it is what made avg_spread_bps read
    # 1580 when the names involved trade tens of bps wide.
    spreads = [
        r.spread_bps_at_arrival for r in records
        if r.spread_bps_at_arrival and not _row_unreliable(r)
    ]
    feeds = sorted({f for r in records if (f := getattr(r, "quote_feed", None))})
    notional = sum(
        r.filled_price * (r.filled_qty or r.shares) for r in real_fills
    )
    return {
        "orders": len(records),
        "filled": len(real_fills),
        "unfilled": sum(1 for r in records if not r.filled_price),
        "synthetic_fills": sum(1 for r in records if r.fill_is_synthetic),
        # Traded, but against a quote too broken to measure against
        "unreliable_quotes": sum(1 for r in records if _row_unreliable(r)),
        "quote_feeds": feeds,
        "traded_notional": round(notional, 2),
        "delay": delay,
        "execution": execution,
        "total_shortfall_bps": total_bps,
        "total_shortfall_dollars": round(
            delay["dollars"] + execution["dollars"], 2
        ),
        "avg_spread_bps": round(sum(spreads) / len(spreads), 2) if spreads else None,
    }


def _aggregate_legacy(records) -> dict:
    """The original one-number aggregate, kept so version 1 rows stay reproducible.

    Not comparable with the version 2 figures: planning_price here is the ask for
    buys and sells alike, so sells carry a full spread as cost while buys are
    benchmarked against the worst price they could pay.
    """
    filled = [r for r in records if r.filled_price and r.planning_price]
    notional = sum(r.filled_price * (r.filled_qty or r.shares) for r in filled)
    cost = sum(
        (r.slippage_bps or 0) / 10_000 * r.planning_price * (r.filled_qty or r.shares)
        for r in filled
    )
    return {
        "orders": len(records),
        "filled": len(filled),
        "unfilled": sum(1 for r in records if not r.filled_price),
        "traded_notional": round(notional, 2),
        "cost_dollars": round(cost, 2),
        "avg_slippage_bps": round(cost / notional * 10_000, 2) if notional else 0.0,
    }


async def execution_quality(db: AsyncSession, days: int = 30) -> dict:
    """Execution cost, split into delay and execution legs.

    Version 1 and version 2 rows are aggregated separately and never mixed: they are
    measured against different references, so a combined average would be
    meaningless. `cumulative` and `by_day` keep the legacy shape and cover version 1
    only, so nothing reading them breaks; `shortfall` carries the corrected numbers.
    """
    since = datetime.utcnow() - timedelta(days=days)
    rows_q = await db.execute(
        select(OrderExecution).where(OrderExecution.submitted_at >= since)
    )
    rows = rows_q.scalars().all()

    v2 = [r for r in rows if _is_v2(r)]
    legacy = [r for r in rows if not _is_v2(r)]

    by_day: dict[str, list] = {}
    for r in v2:
        by_day.setdefault(r.submitted_at.date().isoformat(), []).append(r)

    return {
        "window_days": days,
        # Corrected measurement
        "shortfall": _aggregate_v2(v2),
        "shortfall_by_day": [
            {"date": day, **_aggregate_v2(records)}
            for day, records in sorted(by_day.items(), reverse=True)
        ],
        "has_v2": bool(v2),
        # Legacy, ask-benchmarked. Retained for the audit trail only.
        "legacy": _aggregate_legacy(legacy),
        "cumulative": _aggregate_legacy(legacy),
        "by_day": [],
    }
