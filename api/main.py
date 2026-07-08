import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.config.settings import settings
from api.db import engine, async_session
from api.db.models import Base
from api.routes.auth import router as auth_router
from api.routes.dashboard import router as dashboard_router
from api.routes.data import router as data_router
from api.routes.pipeline import router as pipeline_router
from api.routes.portfolio import router as portfolio_router
from api.routes.research import router as research_router
from api.routes.ws import router as ws_router
from api.signals.registry import discover_signals

_scheduler_task: asyncio.Task | None = None


async def _scheduled_loop():
    """Run pipeline automatically on a timer."""
    from api.routes.ws import broadcast
    from api.tracker.evaluator import evaluate_predictions

    await asyncio.sleep(5)

    while True:
        try:
            import api.routes.pipeline as pipeline_mod
            if pipeline_mod._pipeline_running:
                print("[scheduler] Pipeline already running, skipping")
            else:
                await broadcast("pipeline_status", {"status": "running"})
                pipeline_mod._pipeline_running = True
                print("[scheduler] Starting automatic pipeline run...")
                try:
                    await pipeline_mod._run_pipeline_bg()
                except Exception:
                    pipeline_mod._pipeline_running = False
                    raise

                print("[scheduler] Pipeline completed")

                async with async_session() as db:
                    for horizon in (5, 20, 60):
                        r = await evaluate_predictions(db, horizon_days=horizon)
                        if r["evaluated"] > 0:
                            print(f"[scheduler] Evaluated {r['evaluated']} predictions at {horizon}d horizon")

                await broadcast("evaluation_complete", {"status": "done"})

                # Auto-rebalance after pipeline
                if settings.auto_rebalance:
                    try:
                        await broadcast("rebalance_status", {"status": "running"})
                        async with async_session() as db:
                            from api.routes.portfolio import _build_rebalance_inputs, _broker
                            from api.execution.rebalancer import compute_rebalance
                            if not await _broker.is_market_open():
                                result, err = None, "market closed"
                            else:
                                result, err = await _build_rebalance_inputs(db)
                            if err:
                                print(f"[scheduler] Rebalance skipped: {err}")
                            else:
                                plan = compute_rebalance(
                                    current_positions=result["current_positions"],
                                    target_weights=result["target_weights"],
                                    prices=result["prices"],
                                    portfolio_value=result["account"].portfolio_value,
                                    cash=result["account"].cash,
                                    exposure_target=result["exposure"],
                                )
                                if not plan.sells and not plan.buys:
                                    print("[scheduler] Rebalance: portfolio already aligned")
                                else:
                                    from api.routes.portfolio import rebalance_execute
                                    resp = await rebalance_execute(db)
                                    sells = sum(1 for o in resp.get("orders", []) if o["side"] == "sell")
                                    buys = sum(1 for o in resp.get("orders", []) if o["side"] == "buy")
                                    print(f"[scheduler] Rebalanced: {sells} sells, {buys} buys")
                                    await broadcast("rebalance_complete", {
                                        "sells": sells,
                                        "buys": buys,
                                        "skipped": len(plan.skipped),
                                    })
                    except Exception as e:
                        print(f"[scheduler] Rebalance failed: {e}")
                        await broadcast("rebalance_error", {"error": str(e)})

        except Exception as e:
            print(f"[scheduler] Pipeline run failed: {e}")
            await broadcast("pipeline_error", {"error": str(e)})

        interval = settings.pipeline_interval_hours * 3600
        print(f"[scheduler] Next run in {settings.pipeline_interval_hours}h")
        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler_task
    from api.db import init_db
    await init_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    discover_signals()

    # Runs can only execute inside this process, so any row still "running"
    # at boot was killed mid-flight (OOM, deploy) — close it out.
    from datetime import datetime
    from sqlalchemy import update as sa_update
    from api.db.models import PipelineRun
    async with async_session() as db:
        res = await db.execute(
            sa_update(PipelineRun)
            .where(PipelineRun.status == "running")
            .values(
                status="failed",
                finished_at=datetime.utcnow(),
                error_message="interrupted by restart",
            )
        )
        await db.commit()
        if res.rowcount:
            print(f"[startup] Marked {res.rowcount} interrupted pipeline runs as failed")

    # One-time sweep of open trades orphaned by pre-FIFO bookkeeping;
    # cheap no-op when the table is already in sync
    try:
        from api.routes.portfolio import reconcile_trades
        async with async_session() as db:
            await reconcile_trades(db)
    except Exception as e:
        print(f"[startup] Trade reconcile skipped: {e}")

    # Repair missing exit prices/P&L from broker fill history;
    # no-op once every closed trade carries real numbers
    try:
        from api.routes.portfolio import backfill_trade_pnl
        async with async_session() as db:
            await backfill_trade_pnl(db)
    except Exception as e:
        print(f"[startup] P&L backfill skipped: {e}")

    from api.data.registry import init_default_sources
    init_default_sources()

    if settings.auto_run_pipeline:
        _scheduler_task = asyncio.create_task(_scheduled_loop())
        print(f"[scheduler] Auto-pipeline enabled (every {settings.pipeline_interval_hours}h)")

    yield

    if _scheduler_task:
        _scheduler_task.cancel()


app = FastAPI(title="Sigil V2", version="0.1.0", lifespan=lifespan)

# Auth middleware (only active when AUTH_PASSWORD is set)
if settings.auth_password:
    from api.auth import AuthMiddleware
    app.add_middleware(AuthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(pipeline_router)
app.include_router(data_router)
app.include_router(portfolio_router)
app.include_router(research_router)
app.include_router(ws_router)


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


# Serve built frontend in production (must be LAST — catch-all route)
DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"
if DIST_DIR.is_dir():
    from fastapi.responses import FileResponse

    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")

    @app.get("/{path:path}")
    async def serve_spa(path: str):
        file_path = DIST_DIR / path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(
            str(DIST_DIR / "index.html"),
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
