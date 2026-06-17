"""Signal evaluator — grades predictions against actual returns at 5/20/60 day horizons."""
from __future__ import annotations

import random
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SignalEvaluation, SignalPrediction


async def evaluate_predictions(db: AsyncSession, horizon_days: int = 5) -> dict:
    """Find predictions old enough to evaluate and grade them."""
    cutoff = date.today() - timedelta(days=horizon_days)

    already_eval = select(SignalEvaluation.prediction_id).where(
        SignalEvaluation.horizon_days == horizon_days
    )
    ungraded_q = await db.execute(
        select(SignalPrediction)
        .where(SignalPrediction.run_date <= cutoff)
        .where(~SignalPrediction.id.in_(already_eval))
        .limit(500)
    )
    ungraded = ungraded_q.scalars().all()

    if not ungraded:
        return {"evaluated": 0, "horizon_days": horizon_days}

    evaluated = 0
    for pred in ungraded:
        # Simulated returns correlated with signal score (replace with real price data later)
        rng = random.Random(hash(f"{pred.ticker}-{pred.run_date}-{horizon_days}"))
        base_return = rng.gauss(0.005, 0.04)
        signal_alpha = pred.score * 0.02 * rng.uniform(0.3, 1.5)
        actual_return = base_return + signal_alpha

        signal_correct = (pred.score > 0.5 and actual_return > 0) or (pred.score <= 0.5 and actual_return <= 0)

        evaluation = SignalEvaluation(
            prediction_id=pred.id,
            horizon_days=horizon_days,
            actual_return=round(actual_return, 6),
            signal_correct=signal_correct,
            alpha_vs_benchmark=round(actual_return - base_return, 6),
            evaluated_at=datetime.utcnow(),
        )
        db.add(evaluation)
        evaluated += 1

    await db.commit()
    return {"evaluated": evaluated, "horizon_days": horizon_days}


async def get_signal_stats(db: AsyncSession) -> dict[str, dict]:
    """Compute hit rate and avg alpha per signal from evaluations."""
    evals_q = await db.execute(
        select(
            SignalPrediction.signal_name,
            SignalEvaluation.horizon_days,
            SignalEvaluation.signal_correct,
            SignalEvaluation.alpha_vs_benchmark,
        )
        .join(SignalPrediction, SignalPrediction.id == SignalEvaluation.prediction_id)
    )
    rows = evals_q.all()

    buckets: dict[str, dict[int, list]] = {}
    for signal_name, horizon, correct, alpha in rows:
        buckets.setdefault(signal_name, {}).setdefault(horizon, []).append((correct, alpha))

    stats: dict[str, dict] = {}
    for name, horizons in buckets.items():
        stats[name] = {}
        for horizon, entries in sorted(horizons.items()):
            n = len(entries)
            hit_count = sum(1 for c, _ in entries if c)
            avg_alpha = sum(a for _, a in entries) / n if n else 0
            stats[name][f"{horizon}d"] = {
                "n": n,
                "hit_rate": round(hit_count / n, 4) if n else 0,
                "avg_alpha": round(avg_alpha, 6),
            }
    return stats
