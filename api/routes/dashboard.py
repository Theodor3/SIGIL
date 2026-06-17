from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.db.models import PipelineRun, SignalPrediction, Trade

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard-data")
async def get_dashboard_data(db: AsyncSession = Depends(get_db)):
    """Main dashboard payload — consumed by the React frontend."""
    from api.signals.registry import get_registry

    signals = get_registry()
    signal_info = [
        {"name": s.name, "version": s.version, "weight": s.default_weight, "description": s.describe()}
        for s in signals.values()
    ]

    # Get latest pipeline run
    latest_run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = latest_run_q.scalar_one_or_none()

    pipeline_status = {
        "last_run": latest_run.started_at.isoformat() if latest_run else None,
        "status": latest_run.status if latest_run else "no_runs_yet",
        "run_id": latest_run.id if latest_run else None,
        "universe_size": latest_run.universe_size if latest_run else 0,
        "duration": (
            (latest_run.finished_at - latest_run.started_at).total_seconds()
            if latest_run and latest_run.finished_at
            else None
        ),
    }

    regime = {
        "regime_id": latest_run.regime_id if latest_run else "risk_on",
        "confidence": latest_run.regime_confidence if latest_run else 0.5,
        "exposure": 0.75,
    }

    # Get top ideas from latest run
    top_ideas = []
    if latest_run:
        # Get all predictions for the latest run, compute weighted scores
        preds_q = await db.execute(
            select(SignalPrediction)
            .where(SignalPrediction.run_id == latest_run.id)
        )
        preds = preds_q.scalars().all()

        # Group by ticker
        by_ticker: dict[str, dict] = {}
        for p in preds:
            if p.ticker not in by_ticker:
                by_ticker[p.ticker] = {"scores": {}, "confidences": []}
            by_ticker[p.ticker]["scores"][p.signal_name] = p.score
            if p.confidence > 0:
                by_ticker[p.ticker]["confidences"].append(p.confidence)

        # Score each ticker
        weights = {s.name: s.default_weight for s in signals.values()}
        scored = []
        for ticker, data in by_ticker.items():
            weighted_sum = sum(
                data["scores"].get(sig, 0) * w
                for sig, w in weights.items()
            )
            avg_conf = sum(data["confidences"]) / max(len(data["confidences"]), 1) if data["confidences"] else 0.6
            scored.append({
                "ticker": ticker,
                "final_score": round(weighted_sum, 6),
                "confidence": round(avg_conf, 4),
                "signal_scores": {k: round(v, 4) for k, v in data["scores"].items()},
            })

        scored.sort(key=lambda x: x["final_score"], reverse=True)
        top_ideas = scored[:20]
        for i, idea in enumerate(top_ideas):
            idea["rank"] = i + 1

    # Signal health stats with evaluation data
    from api.tracker.evaluator import get_signal_stats

    eval_stats = await get_signal_stats(db)

    signal_health = []
    for sig in signals.values():
        count_q = await db.execute(
            select(func.count(SignalPrediction.id))
            .where(SignalPrediction.signal_name == sig.name)
        )
        pred_count = count_q.scalar() or 0
        stats = eval_stats.get(sig.name, {})
        signal_health.append({
            "name": sig.name,
            "version": sig.version,
            "weight": sig.default_weight,
            "description": sig.describe(),
            "prediction_count": pred_count,
            "eval_stats": stats,
        })

    # Recent pipeline runs
    runs_q = await db.execute(
        select(PipelineRun).order_by(PipelineRun.started_at.desc()).limit(10)
    )
    recent_runs = [
        {
            "id": r.id,
            "started_at": r.started_at.isoformat(),
            "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            "status": r.status,
            "regime_id": r.regime_id,
            "universe_size": r.universe_size,
        }
        for r in runs_q.scalars().all()
    ]

    # Portfolio summary
    from api.execution.alpaca_broker import AlpacaBroker
    broker = AlpacaBroker()
    account = await broker.get_account()
    positions = await broker.get_positions()

    open_trades_q = await db.execute(
        select(func.count(Trade.id)).where(Trade.status == "open")
    )
    open_trade_count = open_trades_q.scalar() or 0

    closed_trades_q = await db.execute(
        select(func.sum(Trade.realized_pnl)).where(Trade.status == "closed")
    )
    total_pnl = closed_trades_q.scalar() or 0.0

    portfolio_summary = {
        "holdings_count": len(positions) + open_trade_count,
        "total_value": account.portfolio_value,
        "equity": account.equity,
        "cash": account.cash,
        "buying_power": account.buying_power,
        "unrealized_pnl": sum(p.unrealized_pnl for p in positions),
        "realized_pnl": total_pnl,
        "is_demo": broker.is_demo,
    }

    return {
        "status": "ok",
        "signals": signal_health,
        "regime": regime,
        "top_ideas": top_ideas,
        "portfolio": portfolio_summary,
        "pipeline": pipeline_status,
        "recent_runs": recent_runs,
    }


@router.get("/signals")
async def list_signals():
    from api.signals.registry import get_registry

    signals = get_registry()
    return [
        {"name": s.name, "version": s.version, "weight": s.default_weight, "description": s.describe()}
        for s in signals.values()
    ]
