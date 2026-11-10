import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import cache
from api.db import get_db, async_session
from api.pipeline.runner import run_pipeline
from api.tracker.evaluator import evaluate_predictions, get_signal_stats

router = APIRouter(prefix="/api", tags=["pipeline"])

_pipeline_running = False


async def _run_pipeline_bg():
    global _pipeline_running
    try:
        async with async_session() as db:
            await run_pipeline(db)
            cache.clear()
    except Exception as e:
        print(f"[pipeline] Background run failed: {e}")
    finally:
        _pipeline_running = False


@router.post("/pipeline/run")
async def trigger_pipeline():
    """Trigger a full pipeline run in the background."""
    global _pipeline_running
    if _pipeline_running:
        return {"status": "already_running"}
    _pipeline_running = True
    asyncio.create_task(_run_pipeline_bg())
    return {"status": "started"}


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


@router.get("/pipeline/{run_id}/usage")
async def pipeline_usage(run_id: str, db: AsyncSession = Depends(get_db)):
    """Read saved response accounting without running providers or the pipeline."""
    from api.db.models import PipelineRun, SignalPrediction
    from api.pipeline.usage import summarize_usage

    run = await db.get(PipelineRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Pipeline run not found")
    result = await db.execute(
        select(SignalPrediction.metadata_).where(
            SignalPrediction.run_id == run_id,
            SignalPrediction.signal_name == "llm_conviction",
        )
    )
    return {
        "run_id": run.id,
        "run_status": run.status,
        **summarize_usage(result.scalars().all()),
    }