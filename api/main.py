import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.config.settings import settings
from api.db import engine, async_session
from api.db.models import Base
from api.routes.agent import router as agent_router
from api.routes.auth import router as auth_router
from api.routes.dashboard import router as dashboard_router
from api.routes.data import router as data_router
from api.routes.pipeline import router as pipeline_router
from api.routes.portfolio import router as portfolio_router
from api.routes.research import router as research_router
from api.routes.ws import router as ws_router
from api.signals.registry import discover_signals

_scheduler_task: asyncio.Task | None = None
_equity_task: asyncio.Task | None = None


def _minutes_since_open_et() -> int:
    """Minutes since 09:30 ET; negative before the open."""
    from datetime import datetime as dt
    from zoneinfo import ZoneInfo
    now = dt.now(ZoneInfo("America/New_York"))
    return (now.hour * 60 + now.minute) - (9 * 60 + 30)


async def _equity_loop():
    """Hourly account-equity snapshot — the performance history heartbeat.

    First capture waits out the boot window: startup backfill, the boot
    pipeline run, and evaluation all contend for SQLite's single writer,
    and the snapshot is the one writer that can afford to be late."""
    from api.routes.portfolio import _broker
    from api.tracker.equity import capture_snapshot

    await asyncio.sleep(300)
    while True:
        try:
            async with async_session() as db:
                await capture_snapshot(db, _broker)
        except Exception as e:
            print(f"[equity] Snapshot failed: {e}")
        await asyncio.sleep(3600)


async def _scheduled_loop():
    """Run pipeline automatically on a timer."""
    from sqlalchemy import select as sa_select
    from api.db.models import PipelineRun as _PR
    from api.routes.ws import broadcast
    from api.tracker.evaluator import evaluate_predictions

    async def _last_completed_run():
        async with async_session() as db:
            q = await db.execute(
                sa_select(_PR)
                .where(_PR.status == "completed")
                .order_by(_PR.started_at.desc())
                .limit(1)
            )
            return q.scalar_one_or_none()

    await asyncio.sleep(5)

    while True:
        try:
            # A deploy reboots this loop — that must not mean a full
            # pipeline rerun. Skip the run when the last completed one is
            # fresher than the interval, but still fall through to the
            # rebalance block so a rebooted container can make the day's
            # trade if it hasn't happened yet.
            last_run = await _last_completed_run()
            interval_s = settings.pipeline_interval_hours * 3600
            run_age_s = None
            if last_run:
                ts = last_run.finished_at or last_run.started_at
                run_age_s = (datetime.utcnow() - ts).total_seconds()

            import api.routes.pipeline as pipeline_mod
            if pipeline_mod._pipeline_running:
                print("[scheduler] Pipeline already running, skipping")
            elif run_age_s is not None and run_age_s < interval_s:
                print(f"[scheduler] Last pipeline ran {run_age_s / 3600:.1f}h ago — "
                      f"skipping run (interval {settings.pipeline_interval_hours}h)")
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
                        if r["evaluated"] > 0 or r.get("skipped_no_data") or r.get("error"):
                            # A horizon that grades nothing while skipping
                            # rows is a data problem — it must never again
                            # be invisible in the logs
                            print(f"[scheduler] Horizon {horizon}d: {r}")

                await broadcast("evaluation_complete", {"status": "done"})

                # Backfill fill prices for any orders still pending from
                # earlier rebalances (limit orders can fill after the
                # submit-time poll gives up)
                try:
                    from api.tracker.execution import reconcile_executions
                    from api.routes.portfolio import _broker as _reb_broker
                    async with async_session() as db:
                        r = await reconcile_executions(db, _reb_broker)
                        if r["reconciled"]:
                            print(f"[scheduler] Reconciled {r['reconciled']} order fills")
                except Exception as e:
                    print(f"[scheduler] Execution reconcile failed: {e}")

                # Bound the volume: drop predictions past the retention window
                try:
                    from api.db.retention import prune_old_predictions
                    async with async_session() as db:
                        p = await prune_old_predictions(db)
                        if p["pruned_predictions"]:
                            print(f"[scheduler] Pruned {p['pruned_predictions']} predictions, "
                                  f"{p['pruned_evaluations']} evaluations past retention")
                except Exception as e:
                    print(f"[scheduler] Retention pruning failed: {e}")

            # Auto-rebalance — runs whether or not the pipeline was skipped,
            # gated by its own interval + market-hours checks
            if settings.auto_rebalance:
                    try:
                        await broadcast("rebalance_status", {"status": "running"})
                        from api.routes.portfolio import _build_rebalance_inputs, _broker
                        from api.execution.rebalancer import compute_rebalance
                        from api.db.state import get_state

                        # Gate check in its own short-lived session. No DB
                        # session may be held across the sleeps below — an
                        # idle SQLite read transaction blocks every other
                        # writer (equity snapshots failed all night once).
                        async with async_session() as db:
                            last_reb = await get_state(db, "last_rebalance_at")

                        # A rebalance ran recently (this includes every
                        # boot — deploys must not trade)
                        skip_reason = None
                        if last_reb:
                            elapsed = datetime.utcnow() - datetime.fromisoformat(last_reb)
                            remaining = timedelta(hours=settings.min_rebalance_interval_hours) - elapsed
                            if remaining > timedelta(0):
                                if remaining <= timedelta(hours=6):
                                    # Close enough — wait it out rather than
                                    # punting the day's trade entirely
                                    print(f"[scheduler] Rebalance eligible in {remaining.total_seconds() / 3600:.1f}h — waiting")
                                    await asyncio.sleep(remaining.total_seconds())
                                else:
                                    skip_reason = f"last rebalance {elapsed} ago (min {settings.min_rebalance_interval_hours}h)"

                        if skip_reason is None:
                            # Market closed: defer to just after the next
                            # open rather than skipping — a 24h interval
                            # anchored to an evening boot would otherwise
                            # never land in market hours. Deferring also
                            # re-anchors the whole loop to ~the open.
                            until_open = await _broker.seconds_until_market_open()
                            if until_open is None:
                                skip_reason = "market clock unavailable"
                            elif until_open > 0:
                                wait_s = until_open + settings.open_quiet_minutes * 60
                                print(f"[scheduler] Market closed — deferring rebalance {wait_s / 3600:.1f}h until after next open")
                                await asyncio.sleep(wait_s)
                            else:
                                # Open now: sit out the auction window
                                mins = _minutes_since_open_et()
                                if 0 <= mins < settings.open_quiet_minutes:
                                    wait_s = (settings.open_quiet_minutes - mins) * 60
                                    print(f"[scheduler] Waiting {wait_s}s for the open to settle")
                                    await asyncio.sleep(wait_s)

                        if skip_reason:
                            print(f"[scheduler] Rebalance skipped: {skip_reason}")
                        else:
                            # Fresh session now that all waiting is done
                            async with async_session() as db:
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
                                        ranks=result["ranks"],
                                        keep_rank=settings.rebalance_keep_rank,
                                        max_turnover_pct=settings.rebalance_max_turnover_pct,
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

        # Sleep only until the next run is actually due — a cycle that
        # skipped the pipeline sleeps the remainder, not a fresh interval
        wait_s = settings.pipeline_interval_hours * 3600
        try:
            lr = await _last_completed_run()
            if lr:
                ts = lr.finished_at or lr.started_at
                age = (datetime.utcnow() - ts).total_seconds()
                wait_s = max(600.0, settings.pipeline_interval_hours * 3600 - age)
        except Exception:
            pass
        print(f"[scheduler] Next pipeline check in {wait_s / 3600:.1f}h")
        await asyncio.sleep(wait_s)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler_task
    from api.db import init_db
    await init_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all builds missing tables but never adds columns to existing ones,
        # so additive schema changes need an explicit pass. See ensure_columns.
        from api.db.ensure_columns import ensure_columns
        added = await ensure_columns(conn)
        for table, columns in added.items():
            print(f"[startup] Added columns to {table}: {', '.join(columns)}")
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

    # NOTE: the closed-trade rebuild is no longer run at boot. It became
    # re-runnable (each run rewrites the full fill-derived history), which
    # makes it too heavy for startup — a 10k-order fetch racing the boot
    # pipeline for SQLite's writer. Repair on demand instead:
    # POST /api/portfolio/rebuild-closed-trades

    # One-time equity-history backfill from broker portfolio history
    try:
        from api.routes.portfolio import _broker
        from api.tracker.equity import backfill_equity_history
        async with async_session() as db:
            await backfill_equity_history(db, _broker)
    except Exception as e:
        print(f"[startup] Equity backfill skipped: {e}")

    from api.data.registry import init_default_sources
    init_default_sources()

    if settings.auto_run_pipeline:
        _scheduler_task = asyncio.create_task(_scheduled_loop())
        print(f"[scheduler] Auto-pipeline enabled (every {settings.pipeline_interval_hours}h)")

    global _equity_task
    _equity_task = asyncio.create_task(_equity_loop())

    yield

    if _scheduler_task:
        _scheduler_task.cancel()
    if _equity_task:
        _equity_task.cancel()


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
app.include_router(agent_router)
app.include_router(dashboard_router)
app.include_router(pipeline_router)
app.include_router(data_router)
app.include_router(portfolio_router)
app.include_router(research_router)
app.include_router(ws_router)

from api.routes.watchlist import router as watchlist_router  # noqa: E402
app.include_router(watchlist_router)


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
