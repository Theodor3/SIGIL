"""Research API — ticker drilldowns with signal attribution and catalysts."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import cache
from api.model.score_snapshot import read_run_scores
from api.db import get_db
from api.db.models import PipelineRun, SignalPrediction, SignalEvaluation, Trade

router = APIRouter(prefix="/api/research", tags=["research"])


@router.get("/backtest/{signal_name}")
async def backtest(signal_name: str, horizons: str = "5,20", round_trip_cost_bps: float | None = None):
    """Replay a signal over recorded pipeline contexts and grade its calls
    against subsequent prices with matched SPY dates and optional assumed costs."""
    from api.research.backtester import backtest_signal
    try:
        parsed = tuple(sorted({int(h) for h in horizons.split(",") if h.strip()}))
    except ValueError:
        return {"error": f"bad horizons: {horizons}"}
    if not parsed:
        parsed = (5, 20)
    return await backtest_signal(signal_name, horizons=parsed, round_trip_cost_bps=round_trip_cost_bps)


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
    ticker = ticker.upper()

    # Latest predictions for this ticker
    latest_run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = latest_run_q.scalar_one_or_none()

    saved_scores, score_status = read_run_scores(latest_run)
    saved = next((row for row in saved_scores if row['ticker'] == ticker), None)
    current_signals = []
    if saved:
        preds_q = await db.execute(select(SignalPrediction).where(
            SignalPrediction.run_id == latest_run.id, SignalPrediction.ticker == ticker))
        metadata = {p.signal_name: p.metadata_ or {} for p in preds_q.scalars().all()}
        current_signals = [{
            'signal': name, 'score': value,
            'confidence': None,
            'weight': None,
            'contribution': None,
            'metadata': metadata.get(name, {}),
        } for name, value in saved['signal_scores'].items()]

    elif score_status == 'saved':
        score_status = 'ticker_unavailable'

    # Run identity, not date alone, preserves multiple runs on the same day.
    cutoff = date.today() - timedelta(days=30)
    history_q = await db.execute(select(PipelineRun).where(
        PipelineRun.status == 'completed', PipelineRun.started_at >= cutoff
    ).order_by(PipelineRun.started_at.desc(), PipelineRun.id.desc()))
    score_history = []
    for historical_run in history_q.scalars().all():
        rows, status = read_run_scores(historical_run)
        row = next((r for r in rows if r['ticker'] == ticker), None)
        score_history.append({'run_id': historical_run.id,
            'date': historical_run.started_at.isoformat(),
            'score': row['final_score'] if row else None,
            'score_status': status if row or status != 'saved' else 'ticker_unavailable',
            'signals': row['signal_scores'] if row else {}})

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
        "final_score": saved["final_score"] if saved else None,
        "score_status": score_status,
        "eligible": saved["eligible"] if saved else None,
        "confidence": saved["confidence"] if saved else None,
        "signals": current_signals,
        "score_history": score_history,
        "evaluations": evaluations,
        "trades": trades,
        "run_date": latest_run.started_at.isoformat() if latest_run else None,
    }


@router.get("/top-ideas")
async def top_ideas_detailed(db: AsyncSession = Depends(get_db)):
    """Extended top ideas with signal attribution for each."""
    latest_run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = latest_run_q.scalar_one_or_none()
    rows, score_status = read_run_scores(latest_run)
    metadata = {}
    if rows:
        preds_q = await db.execute(select(SignalPrediction).where(
            SignalPrediction.run_id == latest_run.id))
        for pred in preds_q.scalars().all():
            metadata.setdefault(pred.ticker, {})[pred.signal_name] = pred.metadata_ or {}
    ideas = []
    for row in rows[:30]:

        ideas.append({**row, 'top_drivers': [],
                      'metadata': metadata.get(row['ticker'], {})})
    return {'ideas': ideas, 'score_status': score_status,
            'run_date': latest_run.started_at.isoformat() if latest_run else None,
            'regime': latest_run.regime_id if latest_run else None}
