"""Portfolio & trading API routes."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.db.models import Trade
from api.execution.alpaca_broker import AlpacaBroker

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
            "total_trades": len(open_trades) + len(closed_trades),
            "open_count": len(open_trades),
            "closed_count": len(closed_trades),
            "total_realized_pnl": sum(t.get("realized_pnl", 0) or 0 for t in closed_trades),
            "win_rate": (
                sum(1 for t in closed_trades if (t.get("realized_pnl") or 0) > 0) / len(closed_trades)
                if closed_trades else 0
            ),
        },
    }


@router.post("/generate-targets")
async def generate_targets(db: AsyncSession = Depends(get_db)):
    """Generate portfolio targets from latest pipeline run."""
    from api.db.models import PipelineRun, SignalPrediction
    from api.model.portfolio import PortfolioConstraints, construct_portfolio
    from api.model.scorer import ScoredTicker
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

    by_ticker: dict[str, dict] = {}
    for p in preds:
        if p.ticker not in by_ticker:
            by_ticker[p.ticker] = {"scores": {}, "confidences": []}
        by_ticker[p.ticker]["scores"][p.signal_name] = p.score
        if p.confidence > 0:
            by_ticker[p.ticker]["confidences"].append(p.confidence)

    scored = []
    for ticker, data in by_ticker.items():
        weighted_sum = sum(data["scores"].get(sig, 0) * w for sig, w in weights.items())
        avg_conf = sum(data["confidences"]) / max(len(data["confidences"]), 1) if data["confidences"] else 0.6
        scored.append(ScoredTicker(
            ticker=ticker,
            final_score=round(weighted_sum, 6),
            confidence=round(avg_conf, 4),
            signal_scores={k: round(v, 4) for k, v in data["scores"].items()},
            eligible=avg_conf >= 0.58,
            gate_flags={"confidence": avg_conf >= 0.58},
        ))
    scored.sort(key=lambda x: x.final_score, reverse=True)

    account = await _broker.get_account()
    tickers = [s.ticker for s in scored[:20] if s.eligible]
    prices = await _broker.get_prices(tickers)
    sectors = {t: "Unknown" for t in tickers}

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
    """Execute portfolio targets — places orders and records trades."""
    from api.db.models import PipelineRun

    # Generate targets first
    targets_resp = await generate_targets(db)
    if "error" in targets_resp:
        return targets_resp

    targets = targets_resp["targets"]
    if not targets:
        return {"message": "No targets to execute", "trades": []}

    # Get current regime
    run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = run_q.scalar_one_or_none()
    regime = latest_run.regime_id if latest_run else "unknown"

    results = []
    for target in targets:
        order = await _broker.submit_order(
            target["ticker"], target["shares"], "buy" if target["side"] == "long" else "sell"
        )

        trade = Trade(
            opened_at=datetime.utcnow(),
            ticker=target["ticker"],
            side=target["side"],
            entry_price=order.filled_price,
            shares=target["shares"],
            signal_drivers=target["signal_scores"],
            regime_at_entry=regime,
            status="open",
        )
        db.add(trade)
        results.append({
            "ticker": target["ticker"],
            "shares": target["shares"],
            "order_id": order.order_id,
            "order_status": order.status,
        })

    await db.commit()
    return {"message": f"Executed {len(results)} trades", "is_demo": _broker.is_demo, "trades": results}


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
