"""Research API — ticker drilldowns with signal attribution and catalysts."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import cache
from api.db import get_db
from api.db.models import PipelineRun, SignalPrediction, SignalEvaluation, Trade

router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/backtest/{signal_name}")
async def backtest(signal_name: str, horizons: str = "5,20"):
    """Replay a signal over recorded pipeline contexts and grade its calls
    against real subsequent prices vs SPY — same math as the live evaluator."""
    from api.research.backtester import backtest_signal
    try:
        parsed = tuple(sorted({int(h) for h in horizons.split(",") if h.strip()}))
    except ValueError:
        return {"error": f"bad horizons: {horizons}"}
    if not parsed:
        parsed = (5, 20)
    return await backtest_signal(signal_name, horizons=parsed)


@router.get("/backtest-coverage")
async def backtest_coverage():
    """How much recorded history is available for backtests."""
    from api.research.context_store import list_snapshot_dates
    dates = list_snapshot_dates()
    return {
        "snapshots": len(dates),
        "first": dates[0].isoformat() if dates else None,
        "last": dates[-1].isoformat() if dates else None,
    }


@router.get("/ticker/{ticker}")
async def ticker_drilldown(ticker: str, db: AsyncSession = Depends(get_db)):
    """Deep dive on a single ticker — signal breakdown, prediction history, trades."""
    from api.signals.registry import get_registry

    signals = get_registry()
    weights = {s.name: s.default_weight for s in signals.values()}
    ticker = ticker.upper()

    # Latest predictions for this ticker
    latest_run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = latest_run_q.scalar_one_or_none()

    current_signals = []
    final_score = 0.0
    avg_confidence = 0.0
    if latest_run:
        preds_q = await db.execute(
            select(SignalPrediction).where(
                SignalPrediction.run_id == latest_run.id,
                SignalPrediction.ticker == ticker,
            )
        )
        preds = preds_q.scalars().all()
        confidences = []
        for p in preds:
            w = weights.get(p.signal_name, 0)
            contribution = p.score * w
            final_score += contribution
            if p.confidence > 0:
                confidences.append(p.confidence)
            current_signals.append({
                "signal": p.signal_name,
                "score": round(p.score, 4),
                "confidence": round(p.confidence, 4),
                "weight": round(w, 4),
                "contribution": round(contribution, 6),
                "metadata": p.metadata_ or {},
            })
        current_signals.sort(key=lambda x: x["contribution"], reverse=True)
        avg_confidence = sum(confidences) / max(len(confidences), 1) if confidences else 0

    # Prediction history across runs (last 30 days)
    cutoff = date.today() - timedelta(days=30)
    history_q = await db.execute(
        select(SignalPrediction)
        .where(
            SignalPrediction.ticker == ticker,
            SignalPrediction.run_date >= cutoff,
        )
        .order_by(SignalPrediction.run_date.desc())
    )
    history_preds = history_q.scalars().all()

    by_run: dict[str, dict] = {}
    for p in history_preds:
        if p.run_id not in by_run:
            by_run[p.run_id] = {"run_date": p.run_date.isoformat(), "signals": {}, "total": 0.0}
        by_run[p.run_id]["signals"][p.signal_name] = round(p.score, 4)
        by_run[p.run_id]["total"] += p.score * weights.get(p.signal_name, 0)

    score_history = [
        {"date": v["run_date"], "score": round(v["total"], 6), "signals": v["signals"]}
        for v in by_run.values()
    ]

    # Evaluations for this ticker
    eval_q = await db.execute(
        select(SignalEvaluation, SignalPrediction)
        .join(SignalPrediction, SignalEvaluation.prediction_id == SignalPrediction.id)
        .where(SignalPrediction.ticker == ticker)
        .order_by(SignalEvaluation.evaluated_at.desc())
        .limit(50)
    )
    evaluations = []
    for ev, pred in eval_q.all():
        evaluations.append({
            "signal": pred.signal_name,
            "horizon_days": ev.horizon_days,
            "actual_return": ev.actual_return,
            "signal_correct": ev.signal_correct,
            "alpha": ev.alpha_vs_benchmark,
            "date": pred.run_date.isoformat(),
        })

    # Trade history for this ticker
    trades_q = await db.execute(
        select(Trade).where(Trade.ticker == ticker).order_by(Trade.opened_at.desc()).limit(20)
    )
    trades = [
        {
            "id": t.id,
            "side": t.side,
            "shares": t.shares,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "realized_pnl": t.realized_pnl,
            "opened_at": t.opened_at.isoformat(),
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "status": t.status,
            "regime": t.regime_at_entry,
        }
        for t in trades_q.scalars().all()
    ]

    # Fetch company info from Yahoo (cached 10 min — live API call)
    cache_key = f"company:{ticker}"
    company_info = cache.get(cache_key)
    if company_info is None:
        company_info = {}
        try:
            import yfinance as yf
            t_obj = yf.Ticker(ticker)
            info = t_obj.info or {}
            company_info = {
                "name": info.get("shortName") or info.get("longName", ticker),
                "description": (info.get("longBusinessSummary") or "")[:600],
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "market_cap": info.get("marketCap"),
                "price": info.get("regularMarketPrice"),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
                "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
            }
            cache.set(cache_key, company_info, ttl=600)
        except Exception:
            pass

    return {
        "ticker": ticker,
        "company": company_info,
        "final_score": round(final_score, 6),
        "confidence": round(avg_confidence, 4),
        "signals": current_signals,
        "score_history": score_history,
        "evaluations": evaluations,
        "trades": trades,
        "run_date": latest_run.started_at.isoformat() if latest_run else None,
    }


@router.get("/top-ideas")
async def top_ideas_detailed(db: AsyncSession = Depends(get_db)):
    """Extended top ideas with signal attribution for each."""
    from api.signals.registry import get_registry

    signals = get_registry()
    weights = {s.name: s.default_weight for s in signals.values()}

    latest_run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = latest_run_q.scalar_one_or_none()
    if not latest_run:
        return {"ideas": [], "run_date": None}

    preds_q = await db.execute(
        select(SignalPrediction).where(SignalPrediction.run_id == latest_run.id)
    )
    preds = preds_q.scalars().all()

    by_ticker: dict[str, dict] = {}
    for p in preds:
        if p.ticker not in by_ticker:
            by_ticker[p.ticker] = {"scores": {}, "confidences": [], "metadata": {}}
        by_ticker[p.ticker]["scores"][p.signal_name] = p.score
        if p.confidence > 0:
            by_ticker[p.ticker]["confidences"].append(p.confidence)
        if p.metadata_:
            by_ticker[p.ticker]["metadata"][p.signal_name] = p.metadata_

    ideas = []
    for ticker, data in by_ticker.items():
        weighted_sum = sum(data["scores"].get(sig, 0) * w for sig, w in weights.items())
        avg_conf = sum(data["confidences"]) / max(len(data["confidences"]), 1) if data["confidences"] else 0.6

        top_drivers = sorted(
            [(sig, data["scores"].get(sig, 0) * w) for sig, w in weights.items()],
            key=lambda x: x[1],
            reverse=True,
        )[:3]

        ideas.append({
            "ticker": ticker,
            "final_score": round(weighted_sum, 6),
            "confidence": round(avg_conf, 4),
            "signal_scores": {k: round(v, 4) for k, v in data["scores"].items()},
            "top_drivers": [{"signal": s, "contribution": round(c, 6)} for s, c in top_drivers],
            "metadata": data["metadata"],
        })

    ideas.sort(key=lambda x: x["final_score"], reverse=True)
    for i, idea in enumerate(ideas[:30]):
        idea["rank"] = i + 1

    return {
        "ideas": ideas[:30],
        "run_date": latest_run.started_at.isoformat(),
        "regime": latest_run.regime_id,
    }
