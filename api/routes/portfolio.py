"""Portfolio & trading API routes."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config.settings import settings
from api.db import get_db
from api.db.models import Trade
from api.db.state import set_state
from api.execution.alpaca_broker import AlpacaBroker
from api.execution.rebalancer import compute_rebalance

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

_broker = AlpacaBroker()


@router.get("")
async def get_portfolio(db: AsyncSession = Depends(get_db)):
    """Full portfolio snapshot — account, positions, trades, sector exposure."""
    account = await _broker.get_account()
    positions = await _broker.get_positions()

    # Open trades from DB
    open_trades_q = await db.execute(
        select(Trade).where(Trade.status == "open").order_by(Trade.opened_at.desc())
    )
    open_trades = [
        {
            "id": t.id,
            "ticker": t.ticker,
            "side": t.side,
            "shares": t.shares,
            "entry_price": t.entry_price,
            "opened_at": t.opened_at.isoformat(),
            "signal_drivers": t.signal_drivers,
            "regime_at_entry": t.regime_at_entry,
        }
        for t in open_trades_q.scalars().all()
    ]

    # Closed trades
    closed_trades_q = await db.execute(
        select(Trade).where(Trade.status == "closed").order_by(Trade.closed_at.desc()).limit(50)
    )
    closed_trades = [
        {
            "id": t.id,
            "ticker": t.ticker,
            "side": t.side,
            "shares": t.shares,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "realized_pnl": t.realized_pnl,
            "opened_at": t.opened_at.isoformat(),
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
        }
        for t in closed_trades_q.scalars().all()
    ]

    # Sector exposure from positions (look up sector from cached company info)
    from api import cache as app_cache
    sector_exposure: dict[str, float] = {}
    total_value = account.portfolio_value or 1
    for pos in positions:
        cached = app_cache.get(f"company:{pos.ticker}")
        sector = (cached or {}).get("sector", "") if cached else ""
        if not sector:
            sector = "Unknown"
        pct = (pos.market_value / total_value) * 100 if total_value else 0
        sector_exposure[sector] = sector_exposure.get(sector, 0) + pct

    # Aggregates over ALL closed trades, not just the 50 shown — and an
    # account-level P&L (equity vs starting capital) that no bookkeeping
    # bug can distort. Win rate counts only trades with a recorded P&L.
    from api.config.settings import settings as app_settings
    agg_q = await db.execute(
        select(
            func.count(Trade.id),
            func.coalesce(func.sum(Trade.realized_pnl), 0.0),
            func.count(Trade.realized_pnl),
            func.sum(case((Trade.realized_pnl > 0, 1), else_=0)),
        ).where(Trade.status == "closed")
    )
    closed_count, total_realized_pnl, graded_count, win_count = agg_q.one()
    total_realized_pnl = round(total_realized_pnl or 0, 2)
    win_rate = (win_count or 0) / graded_count if graded_count else 0
    account_pnl = (
        round(account.equity - app_settings.paper_starting_equity, 2)
        if not _broker.is_demo else 0.0
    )

    return {
        "account": {
            "equity": account.equity,
            "cash": account.cash,
            "buying_power": account.buying_power,
            "portfolio_value": account.portfolio_value,
            "is_demo": _broker.is_demo,
        },
        "positions": [
            {
                "ticker": p.ticker,
                "qty": p.qty,
                "side": p.side,
                "avg_entry": p.avg_entry,
                "current_price": p.current_price,
                "market_value": p.market_value,
                "unrealized_pnl": p.unrealized_pnl,
                "unrealized_pnl_pct": p.unrealized_pnl_pct,
            }
            for p in positions
        ],
        "open_trades": open_trades,
        "closed_trades": closed_trades,
        "sector_exposure": sector_exposure,
        "stats": {
            "total_trades": len(open_trades) + closed_count,
            "open_count": len(open_trades),
            "closed_count": closed_count,
            "total_realized_pnl": total_realized_pnl,
            "account_pnl": account_pnl,
            "win_rate": win_rate,
        },
    }


@router.post("/generate-targets")
async def generate_targets(db: AsyncSession = Depends(get_db)):
    """Generate portfolio targets from latest pipeline run."""
    from api.db.models import PipelineRun, SignalPrediction
    from api.model.portfolio import construct_portfolio
    from api.signals.registry import get_registry

    # Get latest completed run
    run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = run_q.scalar_one_or_none()
    if not latest_run:
        return {"error": "No completed pipeline run found", "targets": []}

    # Get predictions
    preds_q = await db.execute(
        select(SignalPrediction).where(SignalPrediction.run_id == latest_run.id)
    )
    preds = preds_q.scalars().all()

    signals = get_registry()
    weights = {s.name: s.default_weight for s in signals.values()}

    # Rebuild SignalOutputs and use the real scorer (includes regime tilts)
    from api.signals.base import SignalOutput
    from api.model.scorer import score_universe
    from api.regime.detector import DEFAULTS as REGIME_DEFAULTS

    signal_outputs: dict[str, list[SignalOutput]] = {}
    for p in preds:
        signal_outputs.setdefault(p.signal_name, []).append(
            SignalOutput(ticker=p.ticker, score=p.score, confidence=p.confidence, metadata=p.metadata_ or {})
        )

    # Build a regime snapshot from the run's stored regime
    from api.regime.models import RegimeSnapshot
    from datetime import date
    regime_id = latest_run.regime_id or "risk_on"
    regime = RegimeSnapshot(
        as_of_date=date.today(),
        regime_id=regime_id,
        confidence=latest_run.regime_confidence or 0.5,
        recommended_gross_exposure=REGIME_DEFAULTS["exposure"].get(regime_id, 0.75),
        factor_tilts=REGIME_DEFAULTS["factor_tilts"].get(regime_id, {}),
    )
    scored = score_universe(signal_outputs, weights, regime)

    # Watchlist tickers are research-only — never portfolio candidates
    from api.routes.watchlist import get_watchlist_tickers
    watch = set(await get_watchlist_tickers(db))
    if watch:
        scored = [s for s in scored if s.ticker not in watch]

    account = await _broker.get_account()
    tickers = [s.ticker for s in scored[:20] if s.eligible]
    prices = await _broker.get_prices(tickers)

    # Use cached company info for real sector data
    from api import cache as app_cache
    sectors = {}
    for t in tickers:
        cached = app_cache.get(f"company:{t}")
        sectors[t] = (cached or {}).get("sector", "") or "Unknown"

    targets = construct_portfolio(scored, account.equity, prices, sectors)

    return {
        "run_id": latest_run.id,
        "capital": account.equity,
        "is_demo": _broker.is_demo,
        "targets": [
            {
                "ticker": t.ticker,
                "weight": t.weight,
                "shares": t.shares,
                "side": t.side,
                "final_score": t.final_score,
                "confidence": t.confidence,
                "signal_scores": t.signal_scores,
            }
            for t in targets
        ],
    }


@router.post("/execute")
async def execute_targets(db: AsyncSession = Depends(get_db)):
    """Execute portfolio targets via the diff-based rebalancer.

    The old implementation bought every target sized off full equity with no
    sells and no cash cap — repeated clicks stacked positions on margin. The
    rebalancer trades only the diff and respects available cash.
    """
    return await rebalance_execute(db)


async def reconcile_trades(db: AsyncSession) -> dict:
    """Sync open DB trades to broker truth.

    Historical bookkeeping bugs left trades open after the broker position
    was sold (only the earliest trade per ticker got closed). Any open-trade
    shares beyond what the broker actually holds were sold at some
    unrecorded point: close them oldest-first (matching the FIFO sell
    convention) with no exit price or P&L rather than inventing numbers.
    Zero-share ghost trades are closed unconditionally.
    """
    if _broker.is_demo:
        # Demo broker holds no positions — DB trades ARE the demo state
        return {"closed": 0, "reduced": 0, "skipped": "demo mode"}

    positions = await _broker.get_positions()
    broker_qty: dict[str, int] = {}
    for p in positions:
        broker_qty[p.ticker] = broker_qty.get(p.ticker, 0) + max(int(p.qty), 0)

    open_q = await db.execute(
        select(Trade).where(Trade.status == "open").order_by(Trade.opened_at.asc())
    )
    open_trades = open_q.scalars().all()

    by_ticker: dict[str, list[Trade]] = {}
    now = datetime.utcnow()
    closed = reduced = 0

    for trade in open_trades:
        if (trade.shares or 0) <= 0:
            trade.closed_at = now
            trade.status = "closed"
            closed += 1
            continue
        by_ticker.setdefault(trade.ticker, []).append(trade)

    for ticker, trades in by_ticker.items():
        excess = sum(t.shares or 0 for t in trades) - broker_qty.get(ticker, 0)
        for trade in trades:  # oldest first
            if excess <= 0:
                break
            take = min(trade.shares, excess)
            if take >= trade.shares:
                trade.closed_at = now
                trade.status = "closed"
                closed += 1
            else:
                trade.shares -= take
                reduced += 1
            excess -= take

    await db.commit()
    if closed or reduced:
        print(f"[reconcile] Closed {closed} orphaned trades, reduced {reduced} to broker quantities")
    return {"closed": closed, "reduced": reduced}


@router.post("/reconcile")
async def reconcile_endpoint(db: AsyncSession = Depends(get_db)):
    """Manually sync open trades to actual broker positions."""
    return await reconcile_trades(db)


async def rebuild_closed_trades(db: AsyncSession) -> dict:
    """Rebuild closed-trade history from the broker's fill log.

    The legacy closed rows are unreliable: duplicate phantom lots from the
    old execute path, entry prices from fake quotes, and P&L computed from
    missing fills. Individual repair is impossible because those rows never
    mapped to real executions. Instead, FIFO-match actual buy fills against
    actual sell fills and emit true round-trips with real entry and exit
    prices. Existing closed rows are marked status="void" (kept for audit,
    invisible to the UI and stats), then replaced.

    Re-runnable: each run deletes its own previous reconstruction, voids
    whatever other closed rows accumulated since (kept for audit), and
    rewrites the complete fill-derived history — the ledger converges to
    broker truth no matter how mangled the rows in between got.
    """
    if _broker.is_demo:
        return {"rebuilt": 0, "skipped": "demo mode"}

    fills = await _broker.get_fills(max_orders=10_000)
    if not fills:
        return {"rebuilt": 0, "skipped": "no fill history"}
    fills.sort(key=lambda f: f["filled_at"])

    # FIFO match: buys stack up as open lots, sells consume them oldest-first
    open_lots: dict[str, list[dict]] = {}
    round_trips: list[dict] = []
    for f in fills:
        if f["side"] == "buy":
            open_lots.setdefault(f["ticker"], []).append(
                {"qty": f["qty"], "price": f["price"], "at": f["filled_at"]}
            )
            continue
        remaining = f["qty"]
        lots = open_lots.get(f["ticker"], [])
        while remaining > 0 and lots:
            lot = lots[0]
            take = min(lot["qty"], remaining)
            round_trips.append({
                "ticker": f["ticker"],
                "shares": take,
                "entry_price": lot["price"],
                "exit_price": f["price"],
                "opened_at": lot["at"],
                "closed_at": f["filled_at"],
                "pnl": round((f["price"] - lot["price"]) * take, 2),
            })
            lot["qty"] -= take
            remaining -= take
            if lot["qty"] <= 0:
                lots.pop(0)
        # remaining > 0 with no lots = sell without a recorded buy; skip —
        # P&L is unknowable without an entry

    # Drop the previous reconstruction (re-derived below), void everything
    # else that closed since — those rows never reliably mapped to fills
    from sqlalchemy import delete as sa_delete
    await db.execute(
        sa_delete(Trade).where(
            Trade.status.in_(("closed", "void")),
            Trade.regime_at_entry == "reconstructed",
        )
    )
    closed_q = await db.execute(select(Trade).where(Trade.status == "closed"))
    voided = 0
    for trade in closed_q.scalars().all():
        trade.status = "void"
        voided += 1

    for rt in round_trips:
        db.add(Trade(
            opened_at=rt["opened_at"].replace(tzinfo=None),
            closed_at=rt["closed_at"].replace(tzinfo=None),
            ticker=rt["ticker"],
            side="long",
            entry_price=round(rt["entry_price"], 4),
            exit_price=round(rt["exit_price"], 4),
            shares=int(rt["shares"]),
            realized_pnl=rt["pnl"],
            signal_drivers={},
            regime_at_entry="reconstructed",
            status="closed",
        ))

    await db.commit()
    total_pnl = round(sum(rt["pnl"] for rt in round_trips), 2)
    print(f"[rebuild] Voided {voided} legacy closed trades, wrote {len(round_trips)} "
          f"fill-derived round-trips (realized P&L {total_pnl:+.2f})")
    return {"rebuilt": len(round_trips), "voided": voided, "realized_pnl": total_pnl}


@router.post("/rebuild-closed-trades")
async def rebuild_closed_trades_endpoint(db: AsyncSession = Depends(get_db)):
    """Rebuild closed-trade history from broker fills."""
    return await rebuild_closed_trades(db)


@router.post("/reset-account-history")
async def reset_account_history(db: AsyncSession = Depends(get_db)):
    """Fresh-broker-account reset: wipe every table coupled to the old
    account (trades, equity snapshots, order executions) while keeping all
    signal science — predictions, evaluations, and context snapshots are
    account-independent. Run once right after swapping Alpaca keys."""
    from sqlalchemy import delete as sa_delete
    from api.db.models import EquitySnapshot, OrderExecution

    counts = {}
    for label, model in (
        ("trades", Trade),
        ("equity_snapshots", EquitySnapshot),
        ("order_executions", OrderExecution),
    ):
        res = await db.execute(sa_delete(model))
        counts[label] = res.rowcount or 0
    await db.commit()

    # last_rebalance_at is deliberately left alone: the previous stamp keeps
    # the normal daily cadence, so the fresh account's first buys go out at
    # the next scheduled after-open rebalance instead of being pushed a day

    return {"reset": counts, "note": "Old account history cleared; signal "
            "predictions/evaluations/context snapshots untouched."}


def _max_drawdown_pct(equities: list[float]) -> float:
    peak = float("-inf")
    worst = 0.0
    for e in equities:
        peak = max(peak, e)
        if peak > 0:
            worst = min(worst, (e - peak) / peak)
    return round(worst * 100, 2)


async def _spy_series(start_date, end_date) -> tuple[list, list] | None:
    """Daily SPY closes for the benchmark overlay, cached for an hour."""
    from api import cache as app_cache
    key = f"equity_spy:{start_date}:{end_date}"
    cached = app_cache.get(key)
    if cached is not None:
        return cached
    import asyncio as _asyncio
    from api.tracker.evaluator import _download_history_sync
    loop = _asyncio.get_running_loop()
    history = await loop.run_in_executor(
        None, _download_history_sync, ["SPY"], start_date, end_date
    )
    series = history.get("SPY")
    if series:
        app_cache.set(key, series, ttl=3600)
    return series


@router.get("/execution-quality")
async def get_execution_quality(days: int = 30, db: AsyncSession = Depends(get_db)):
    """Slippage and churn-cost stats: planning quote vs actual fill, per day
    and cumulative. Reconciles any pending fills from the broker first."""
    from api.tracker.execution import execution_quality, reconcile_executions
    try:
        await reconcile_executions(db, _broker)
    except Exception as e:
        print(f"[execution] Reconcile on view failed: {e}")
    return await execution_quality(db, days=days)


@router.get("/equity-history")
async def equity_history(days: int = 30, db: AsyncSession = Depends(get_db)):
    """Equity curve with SPY-equivalent benchmark and summary stats.

    days <= 0 returns the full history. Stats are computed server-side from
    the same series the chart renders, so they can never disagree.
    """
    from datetime import timedelta as _td
    from api.db.models import EquitySnapshot
    from api.tracker.evaluator import _price_on_or_before

    q = select(EquitySnapshot).order_by(EquitySnapshot.taken_at.asc())
    if days > 0:
        q = q.where(EquitySnapshot.taken_at >= datetime.utcnow() - _td(days=days))
    rows = (await db.execute(q)).scalars().all()
    if not rows:
        return {"points": [], "stats": None}

    # SPY overlay: normalized to the window's starting equity — the
    # "should have just bought SPY" line. Omitted if Yahoo is down.
    spy = None
    try:
        spy = await _spy_series(
            rows[0].taken_at.date() - _td(days=5), rows[-1].taken_at.date()
        )
    except Exception as e:
        print(f"[equity] SPY benchmark unavailable: {e}")

    first_equity = rows[0].equity
    spy_base = None
    if spy:
        base = _price_on_or_before(spy, rows[0].taken_at.date())
        spy_base = base[1] if base else None

    points = []
    last_spy_equiv = None
    for r in rows:
        point = {
            "t": r.taken_at.isoformat(),
            "equity": round(r.equity, 2),
            "cash": round(r.cash, 2) if r.cash is not None else None,
            "regime": r.regime_id,
        }
        if spy and spy_base:
            px = _price_on_or_before(spy, r.taken_at.date())
            if px:
                last_spy_equiv = round(first_equity * (px[1] / spy_base), 2)
        point["spy"] = last_spy_equiv
        points.append(point)

    last_equity = rows[-1].equity
    return_pct = round((last_equity / first_equity - 1) * 100, 2) if first_equity else 0
    spy_return_pct = None
    if last_spy_equiv and first_equity:
        spy_return_pct = round((last_spy_equiv / first_equity - 1) * 100, 2)

    return {
        "points": points,
        "stats": {
            "start": rows[0].taken_at.isoformat(),
            "end": rows[-1].taken_at.isoformat(),
            "return_pct": return_pct,
            "max_drawdown_pct": _max_drawdown_pct([r.equity for r in rows]),
            "spy_return_pct": spy_return_pct,
            "vs_spy_pct": (
                round(return_pct - spy_return_pct, 2)
                if spy_return_pct is not None else None
            ),
        },
    }


@router.post("/close/{trade_id}")
async def close_trade(trade_id: int, db: AsyncSession = Depends(get_db)):
    """Close an open trade — fetch current price, compute P&L, update DB."""
    trade = await db.get(Trade, trade_id)
    if not trade:
        return {"error": "Trade not found"}
    if trade.status != "open":
        return {"error": f"Trade already {trade.status}"}

    prices = await _broker.get_prices([trade.ticker])
    exit_price = prices.get(trade.ticker)
    if not exit_price:
        return {"error": f"Could not get price for {trade.ticker}"}

    entry = trade.entry_price or exit_price
    if trade.side == "long":
        realized_pnl = (exit_price - entry) * trade.shares
    else:
        realized_pnl = (entry - exit_price) * trade.shares

    trade.exit_price = exit_price
    trade.realized_pnl = round(realized_pnl, 2)
    trade.closed_at = datetime.utcnow()
    trade.status = "closed"
    await db.commit()

    return {
        "trade_id": trade.id,
        "ticker": trade.ticker,
        "exit_price": exit_price,
        "realized_pnl": trade.realized_pnl,
        "status": "closed",
    }


@router.post("/close-all")
async def close_all_trades(db: AsyncSession = Depends(get_db)):
    """Close all open trades at current market prices."""
    open_q = await db.execute(select(Trade).where(Trade.status == "open"))
    open_trades = open_q.scalars().all()
    if not open_trades:
        return {"message": "No open trades", "closed": 0}

    tickers = list({t.ticker for t in open_trades})
    prices = await _broker.get_prices(tickers)
    closed = []
    for trade in open_trades:
        exit_price = prices.get(trade.ticker)
        if not exit_price:
            continue
        entry = trade.entry_price or exit_price
        if trade.side == "long":
            trade.realized_pnl = round((exit_price - entry) * trade.shares, 2)
        else:
            trade.realized_pnl = round((entry - exit_price) * trade.shares, 2)
        trade.exit_price = exit_price
        trade.closed_at = datetime.utcnow()
        trade.status = "closed"
        closed.append({"ticker": trade.ticker, "pnl": trade.realized_pnl})

    await db.commit()
    return {"message": f"Closed {len(closed)} trades", "closed": len(closed), "trades": closed}


async def _build_rebalance_inputs(db: AsyncSession):
    """Shared logic: get current positions, target weights, prices, regime."""
    from api.db.models import PipelineRun, SignalPrediction
    from api.model.portfolio import construct_portfolio
    from api.signals.registry import get_registry
    from api.signals.base import SignalOutput
    from api.model.scorer import score_universe
    from api.regime.detector import DEFAULTS as REGIME_DEFAULTS
    from api.regime.models import RegimeSnapshot
    from datetime import date
    from api import cache as app_cache

    run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = run_q.scalar_one_or_none()
    if not latest_run:
        return None, "No completed pipeline run found"

    preds_q = await db.execute(
        select(SignalPrediction).where(SignalPrediction.run_id == latest_run.id)
    )
    preds = preds_q.scalars().all()

    signals = get_registry()
    weights = {s.name: s.default_weight for s in signals.values()}

    signal_outputs: dict[str, list[SignalOutput]] = {}
    for p in preds:
        signal_outputs.setdefault(p.signal_name, []).append(
            SignalOutput(ticker=p.ticker, score=p.score, confidence=p.confidence, metadata=p.metadata_ or {})
        )

    regime_id = latest_run.regime_id or "risk_on"
    regime = RegimeSnapshot(
        as_of_date=date.today(),
        regime_id=regime_id,
        confidence=latest_run.regime_confidence or 0.5,
        recommended_gross_exposure=REGIME_DEFAULTS["exposure"].get(regime_id, 0.75),
        factor_tilts=REGIME_DEFAULTS["factor_tilts"].get(regime_id, {}),
    )
    scored = score_universe(signal_outputs, weights, regime)

    # Watchlist tickers are research-only — never portfolio candidates
    from api.routes.watchlist import get_watchlist_tickers
    watch = set(await get_watchlist_tickers(db))
    if watch:
        scored = [s for s in scored if s.ticker not in watch]

    account = await _broker.get_account()
    positions = await _broker.get_positions()

    eligible_tickers = [s.ticker for s in scored[:20] if s.eligible]
    held_tickers = [p.ticker for p in positions]
    all_tickers = list(set(eligible_tickers + held_tickers))
    prices = await _broker.get_prices(all_tickers) if all_tickers else {}

    sectors = {}
    for t in eligible_tickers:
        cached = app_cache.get(f"company:{t}")
        sectors[t] = (cached or {}).get("sector", "") or "Unknown"

    targets = construct_portfolio(scored, account.equity, prices, sectors)
    target_weights = {t.ticker: t.weight for t in targets}

    current_positions = {
        p.ticker: {"shares": p.qty, "market_value": p.market_value}
        for p in positions
    }

    exposure = regime.recommended_gross_exposure

    return {
        "account": account,
        "current_positions": current_positions,
        "target_weights": target_weights,
        "prices": prices,
        "exposure": exposure,
        "regime_id": regime_id,
        "run_id": latest_run.id,
        "targets": targets,
        "ranks": {s.ticker: i + 1 for i, s in enumerate(scored)},
    }, None


@router.post("/rebalance/preview")
async def rebalance_preview(db: AsyncSession = Depends(get_db)):
    """Preview the rebalance plan without executing any orders."""
    result, error = await _build_rebalance_inputs(db)
    if error:
        return {"error": error}

    plan = compute_rebalance(
        current_positions=result["current_positions"],
        target_weights=result["target_weights"],
        prices=result["prices"],
        portfolio_value=result["account"].portfolio_value,
        cash=result["account"].cash,
        exposure_target=result["exposure"],
        ranks=result["ranks"],
        keep_rank=settings.rebalance_keep_rank,
        max_turnover_pct=settings.rebalance_max_turnover_pct,
    )

    return {
        "run_id": result["run_id"],
        "regime_id": result["regime_id"],
        "exposure_target": result["exposure"],
        "portfolio_value": result["account"].portfolio_value,
        "cash": result["account"].cash,
        "is_demo": _broker.is_demo,
        "plan": {
            "sells": [
                {
                    "ticker": o.ticker,
                    "shares": o.shares,
                    "reason": o.reason,
                    "current_pct": o.current_pct,
                    "target_pct": o.target_pct,
                    "delta_pct": o.delta_pct,
                }
                for o in plan.sells
            ],
            "buys": [
                {
                    "ticker": o.ticker,
                    "shares": o.shares,
                    "reason": o.reason,
                    "current_pct": o.current_pct,
                    "target_pct": o.target_pct,
                    "delta_pct": o.delta_pct,
                }
                for o in plan.buys
            ],
            "skipped": plan.skipped,
            "total_sell_value": plan.total_sell_value,
            "total_buy_value": plan.total_buy_value,
            "net_cash_change": plan.net_cash_change,
            "positions_before": plan.positions_before,
            "positions_after": plan.positions_after,
            "total_orders": len(plan.sells) + len(plan.buys),
        },
    }


@router.post("/rebalance/execute")
async def rebalance_execute(db: AsyncSession = Depends(get_db)):
    """Execute the rebalance plan — cancel-and-replace, sells first, then buys.

    Pending orders are cancelled before planning: the planner prices the
    account as if nothing is in flight, so a queued set from an earlier
    click (e.g. pre-market) would stack with this plan and fill on top of
    it at the open. Repeated clicks now mean "replace the plan", never
    "add another one".
    """
    cancelled = await _broker.cancel_all_orders()
    if cancelled:
        print(f"[rebalance] Cancelled {cancelled} pending orders before replanning")

    result, error = await _build_rebalance_inputs(db)
    if error:
        return {"error": error}

    plan = compute_rebalance(
        current_positions=result["current_positions"],
        target_weights=result["target_weights"],
        prices=result["prices"],
        portfolio_value=result["account"].portfolio_value,
        cash=result["account"].cash,
        exposure_target=result["exposure"],
        ranks=result["ranks"],
        keep_rank=settings.rebalance_keep_rank,
        max_turnover_pct=settings.rebalance_max_turnover_pct,
    )

    if not plan.sells and not plan.buys:
        await set_state(db, "last_rebalance_at", datetime.utcnow().isoformat())
        return {"message": "Portfolio already aligned with targets", "orders": []}

    regime = result["regime_id"]
    executed = []
    errors = []

    collar = settings.order_limit_collar_pct

    def _limit_for(ticker: str, side: str) -> float | None:
        px = result["prices"].get(ticker) or 0
        if px <= 0:
            return None
        return px * (1 + collar) if side == "buy" else px * (1 - collar)

    from api.tracker.execution import record_order

    # Sells first to free up cash
    for order in plan.sells:
        try:
            sell_limit = _limit_for(order.ticker, "sell")
            res = await _broker.submit_order(
                order.ticker, order.shares, "sell",
                limit_price=sell_limit,
            )
            record_order(
                db,
                order_id=res.order_id,
                ticker=order.ticker,
                side="sell",
                shares=order.shares,
                reason=order.reason,
                planning_price=result["prices"].get(order.ticker),
                limit_price=sell_limit,
                status=res.status,
                filled_price=res.filled_price,
            )
            # Best known exit price: reported fill, else the planning quote.
            # With neither, P&L on affected trades is recorded as 0, not as
            # a fake total loss from treating the fill as $0.
            fill = res.filled_price or result["prices"].get(order.ticker)

            # Walk ALL open DB trades for this ticker (there can be several
            # from older execute paths) — exits close every one of them,
            # trims reduce FIFO by the sold share count.
            trade_q = await db.execute(
                select(Trade)
                .where(Trade.ticker == order.ticker, Trade.status == "open")
                .order_by(Trade.opened_at.asc())
            )
            open_trades = trade_q.scalars().all()
            remaining = order.shares
            for trade in open_trades:
                trade_shares = trade.shares or 0
                if order.reason == "exit":
                    take = trade_shares
                else:
                    if remaining <= 0:
                        break
                    take = min(trade_shares, remaining)
                    remaining -= take
                if take >= trade_shares:
                    entry = trade.entry_price or fill or 0
                    trade.exit_price = fill
                    trade.realized_pnl = round(((fill or entry) - entry) * trade_shares, 2)
                    trade.closed_at = datetime.utcnow()
                    trade.status = "closed"
                else:
                    trade.shares = trade_shares - take

            executed.append({
                "ticker": order.ticker,
                "side": "sell",
                "shares": order.shares,
                "reason": order.reason,
                "order_id": res.order_id,
                "status": res.status,
                "filled_price": res.filled_price,
            })
        except Exception as e:
            errors.append({"ticker": order.ticker, "side": "sell", "error": str(e)})

    # Then buys
    for order in plan.buys:
        try:
            buy_limit = _limit_for(order.ticker, "buy")
            res = await _broker.submit_order(
                order.ticker, order.shares, "buy",
                limit_price=buy_limit,
            )
            record_order(
                db,
                order_id=res.order_id,
                ticker=order.ticker,
                side="buy",
                shares=order.shares,
                reason=order.reason,
                planning_price=result["prices"].get(order.ticker),
                limit_price=buy_limit,
                status=res.status,
                filled_price=res.filled_price,
            )
            if order.reason == "new":
                target_match = next(
                    (t for t in result["targets"] if t.ticker == order.ticker), None
                )
                trade = Trade(
                    opened_at=datetime.utcnow(),
                    ticker=order.ticker,
                    side="long",
                    entry_price=res.filled_price,
                    shares=order.shares,
                    signal_drivers=target_match.signal_scores if target_match else {},
                    regime_at_entry=regime,
                    status="open",
                )
                db.add(trade)
            else:
                # Adding to existing position — update share count
                trade_q = await db.execute(
                    select(Trade)
                    .where(Trade.ticker == order.ticker, Trade.status == "open")
                    .order_by(Trade.opened_at.asc())
                    .limit(1)
                )
                trade = trade_q.scalar_one_or_none()
                if trade:
                    trade.shares += order.shares

            executed.append({
                "ticker": order.ticker,
                "side": "buy",
                "shares": order.shares,
                "reason": order.reason,
                "order_id": res.order_id,
                "status": res.status,
                "filled_price": res.filled_price,
            })
        except Exception as e:
            errors.append({"ticker": order.ticker, "side": "buy", "error": str(e)})

    await db.commit()
    await set_state(db, "last_rebalance_at", datetime.utcnow().isoformat())

    # Sweep up any orphaned open trades now that orders are placed
    try:
        await reconcile_trades(db)
    except Exception as e:
        print(f"[reconcile] Post-rebalance reconcile failed: {e}")

    sell_count = sum(1 for o in executed if o["side"] == "sell")
    buy_count = sum(1 for o in executed if o["side"] == "buy")
    msg = f"Rebalanced: {sell_count} sells, {buy_count} buys"
    if plan.skipped:
        msg += f", {len(plan.skipped)} within tolerance"
    if errors:
        msg += f", {len(errors)} errors"

    return {
        "message": msg,
        "is_demo": _broker.is_demo,
        "orders": executed,
        "errors": errors,
        "skipped": plan.skipped,
    }
