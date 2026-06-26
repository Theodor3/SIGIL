from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import cache
from api.db import get_db
from api.db.models import PipelineRun, SignalPrediction, Trade

router = APIRouter(prefix="/api", tags=["dashboard"])

DASHBOARD_CACHE_KEY = "dashboard_data"
DASHBOARD_CACHE_TTL = 30


@router.get("/dashboard-data")
async def get_dashboard_data(db: AsyncSession = Depends(get_db)):
    """Main dashboard payload — consumed by the React frontend."""
    cached = cache.get(DASHBOARD_CACHE_KEY)
    if cached is not None:
        return cached

    from api.signals.registry import get_registry

    signals = get_registry()
    signal_info = [s.meta() for s in signals.values()]

    # Get latest pipeline run
    latest_run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = latest_run_q.scalar_one_or_none()

    import api.routes.pipeline as pipeline_mod

    pipeline_status = {
        "last_run": latest_run.started_at.isoformat() if latest_run else None,
        "status": "running" if pipeline_mod._pipeline_running else (latest_run.status if latest_run else "no_runs_yet"),
        "run_id": latest_run.id if latest_run else None,
        "universe_size": latest_run.universe_size if latest_run else 0,
        "duration": (
            (latest_run.finished_at - latest_run.started_at).total_seconds()
            if latest_run and latest_run.finished_at
            else None
        ),
    }

    # Build rich regime data
    from api.regime.detector import DEFAULTS as REGIME_DEFAULTS
    regime_id = latest_run.regime_id if latest_run else "risk_on"
    regime_conf = latest_run.regime_confidence if latest_run else 0.5
    exposure_map = REGIME_DEFAULTS["exposure"]
    tilt_map = REGIME_DEFAULTS["factor_tilts"]

    # Pull regime history for sparkline (last 14 completed runs)
    regime_history_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed", PipelineRun.regime_id.isnot(None))
        .order_by(PipelineRun.started_at.desc())
        .limit(14)
    )
    regime_history_runs = list(reversed(regime_history_q.scalars().all()))
    regime_history = [
        {
            "date": r.started_at.strftime("%m/%d"),
            "regime_id": r.regime_id,
            "confidence": r.regime_confidence,
        }
        for r in regime_history_runs
    ]

    # Get latest regime snapshot metadata from the most recent run
    from api.db.models import RegimeHistory
    latest_rh_q = await db.execute(
        select(RegimeHistory).order_by(RegimeHistory.as_of_date.desc()).limit(1)
    )
    latest_rh = latest_rh_q.scalar_one_or_none()

    regime = {
        "regime_id": regime_id,
        "confidence": regime_conf,
        "exposure": exposure_map.get(regime_id, 0.75),
        "factor_tilts": tilt_map.get(regime_id, {}),
        "vol_state": (latest_rh.metadata_ or {}).get("vol_state", "normal") if latest_rh else "normal",
        "breadth_state": latest_rh.breadth_state if latest_rh else "mixed",
        "indicators": {
            "spy_20d": (latest_rh.metadata_ or {}).get("spy_20d") if latest_rh else None,
            "qqq_20d": (latest_rh.metadata_ or {}).get("qqq_20d") if latest_rh else None,
            "vix": latest_rh.vix_level if latest_rh else None,
        },
        "history": regime_history,
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
                by_ticker[p.ticker] = {"scores": {}, "confidences": [], "sector": ""}
            by_ticker[p.ticker]["scores"][p.signal_name] = p.score
            if p.confidence > 0:
                by_ticker[p.ticker]["confidences"].append(p.confidence)
            if p.signal_name == "quality" and p.metadata_:
                by_ticker[p.ticker]["sector"] = p.metadata_.get("sector", "")

        # Score each ticker using group-resolved weights
        from api.model.scorer import load_weights
        weights = load_weights()
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
                "sector": data["sector"],
            })

        scored.sort(key=lambda x: x["final_score"], reverse=True)
        top_ideas = scored[:20]
        for i, idea in enumerate(top_ideas):
            idea["rank"] = i + 1

    # Signal health stats with evaluation data
    from api.tracker.evaluator import get_signal_stats

    eval_stats = await get_signal_stats(db)

    # Build signal-to-group mapping from config
    import json
    from pathlib import Path
    config_path = Path(__file__).resolve().parent.parent / "config" / "alpha_model.json"
    with open(config_path) as f:
        alpha_config = json.load(f)
    sig_to_group = {}
    for group_name, group in alpha_config.get("groups", {}).items():
        for sig_name in group.get("signals", {}):
            sig_to_group[sig_name] = group_name

    resolved_weights = load_weights()

    signal_health = []
    for sig in signals.values():
        count_q = await db.execute(
            select(func.count(SignalPrediction.id))
            .where(SignalPrediction.signal_name == sig.name)
        )
        pred_count = count_q.scalar() or 0
        stats = eval_stats.get(sig.name, {})
        signal_health.append({
            **sig.meta(),
            "weight": round(resolved_weights.get(sig.name, sig.default_weight), 4),
            "group": sig_to_group.get(sig.name, "ungrouped"),
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

    closed_trades_q = await db.execute(
        select(func.sum(Trade.realized_pnl)).where(Trade.status == "closed")
    )
    total_pnl = closed_trades_q.scalar() or 0.0

    portfolio_summary = {
        "holdings_count": len(positions),
        "total_value": account.portfolio_value,
        "equity": account.equity,
        "cash": account.cash,
        "buying_power": account.buying_power,
        "unrealized_pnl": sum(p.unrealized_pnl for p in positions),
        "realized_pnl": total_pnl,
        "is_demo": broker.is_demo,
    }

    # Data source statuses (live from registry)
    from api.data.registry import get_sources
    sources = get_sources()
    data_sources = [
        {
            "name": s.name,
            "provider": s.provider,
            "description": s.description,
            "category": s.category,
            "status": s.status.value,
            "requires_key": s.requires_key,
            "last_fetch": s.last_fetch.isoformat() if s.last_fetch else None,
            "last_fetch_count": s.last_fetch_count,
            "last_error": s.last_error,
        }
        for s in sources.values()
    ]

    # Group budget summary
    group_summary = {
        name: {"budget": round(g["budget"], 2), "signals": list(g["signals"].keys())}
        for name, g in alpha_config.get("groups", {}).items()
    }

    payload = {
        "status": "ok",
        "signals": signal_health,
        "signal_groups": group_summary,
        "regime": regime,
        "top_ideas": top_ideas,
        "portfolio": portfolio_summary,
        "pipeline": pipeline_status,
        "recent_runs": recent_runs,
        "data_sources": data_sources,
    }
    cache.set(DASHBOARD_CACHE_KEY, payload, ttl=DASHBOARD_CACHE_TTL)
    return payload


@router.get("/signals")
async def list_signals():
    from api.signals.registry import get_registry

    signals = get_registry()
    return [
        {"name": s.name, "version": s.version, "weight": s.default_weight, "description": s.describe()}
        for s in signals.values()
    ]
