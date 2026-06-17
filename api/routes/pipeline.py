from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.pipeline.runner import run_pipeline
from api.tracker.evaluator import evaluate_predictions, get_signal_stats

router = APIRouter(prefix="/api", tags=["pipeline"])


@router.post("/pipeline/run")
async def trigger_pipeline(db: AsyncSession = Depends(get_db)):
    """Trigger a full pipeline run."""
    result = await run_pipeline(db)
    return result


@router.post("/pipeline/evaluate")
async def trigger_evaluation(db: AsyncSession = Depends(get_db)):
    """Evaluate past predictions against actual returns."""
    results = {}
    for horizon in (5, 20, 60):
        r = await evaluate_predictions(db, horizon_days=horizon)
        results[f"{horizon}d"] = r
    return results


@router.get("/signals/stats")
async def signal_stats(db: AsyncSession = Depends(get_db)):
    """Get signal accuracy stats from evaluations."""
    return await get_signal_stats(db)
