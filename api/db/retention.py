"""Retention pruning — keep the SQLite volume bounded.

Predictions and their evaluations older than the retention window are
deleted daily. A year of history is plenty for signal statistics; the
tables that stay small forever (trades, equity snapshots, order
executions, pipeline runs) are never touched.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config.settings import settings
from api.db.models import SignalEvaluation, SignalPrediction


async def prune_old_predictions(db: AsyncSession) -> dict:
    retention_days = settings.prediction_retention_days
    if retention_days <= 0:
        return {"pruned_predictions": 0, "pruned_evaluations": 0}

    cutoff = date.today() - timedelta(days=retention_days)

    old_ids = select(SignalPrediction.id).where(SignalPrediction.run_date < cutoff)
    evals_res = await db.execute(
        delete(SignalEvaluation).where(SignalEvaluation.prediction_id.in_(old_ids))
    )
    preds_res = await db.execute(
        delete(SignalPrediction).where(SignalPrediction.run_date < cutoff)
    )
    await db.commit()

    return {
        "pruned_predictions": preds_res.rowcount or 0,
        "pruned_evaluations": evals_res.rowcount or 0,
    }
