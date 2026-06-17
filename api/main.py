import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config.settings import settings
from api.db import engine, async_session
from api.db.models import Base
from api.routes.dashboard import router as dashboard_router
from api.routes.data import router as data_router
from api.routes.pipeline import router as pipeline_router
from api.routes.portfolio import router as portfolio_router
from api.signals.registry import discover_signals

_scheduler_task: asyncio.Task | None = None


async def _scheduled_loop():
    """Run pipeline automatically on a timer."""
    from api.pipeline.runner import run_pipeline
    from api.tracker.evaluator import evaluate_predictions

    await asyncio.sleep(5)

    while True:
        try:
            async with async_session() as db:
                print(f"[scheduler] Starting automatic pipeline run...")
                result = await run_pipeline(db)
                print(f"[scheduler] Pipeline completed: {result['universe_size']} tickers, "
                      f"{len(result['signals_run'])} signals, regime={result['regime']}")

                for horizon in (5, 20, 60):
                    r = await evaluate_predictions(db, horizon_days=horizon)
                    if r["evaluated"] > 0:
                        print(f"[scheduler] Evaluated {r['evaluated']} predictions at {horizon}d horizon")
        except Exception as e:
            print(f"[scheduler] Pipeline run failed: {e}")

        interval = settings.pipeline_interval_hours * 3600
        print(f"[scheduler] Next run in {settings.pipeline_interval_hours}h")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler_task
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    discover_signals()

    from api.data.registry import init_default_sources
    init_default_sources()

    if settings.auto_run_pipeline:
        _scheduler_task = asyncio.create_task(_scheduled_loop())
        print(f"[scheduler] Auto-pipeline enabled (every {settings.pipeline_interval_hours}h)")

    yield

    if _scheduler_task:
        _scheduler_task.cancel()


app = FastAPI(title="Sigil V2", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard_router)
app.include_router(pipeline_router)
app.include_router(data_router)
app.include_router(portfolio_router)


@app.get("/health")
async def health():
    from api.signals.registry import get_registry
    signals = get_registry()
    return {
        "status": "healthy",
        "version": "0.1.0",
        "signals_loaded": len(signals),
        "signal_names": list(signals.keys()),
        "auto_pipeline": settings.auto_run_pipeline,
        "pipeline_interval_hours": settings.pipeline_interval_hours,
    }
