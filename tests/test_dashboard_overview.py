import asyncio
import sys
from datetime import date, datetime
from types import ModuleType, SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from api import cache
from api.db import get_db
from api.db.models import Base, PipelineRun, SignalPrediction


def test_overview_skips_slow_dependencies_and_preserves_full_view(monkeypatch):
    calls = {"broker": 0, "eval": 0}

    def module(name, **values):
        m = ModuleType(name)
        m.__dict__.update(values)
        monkeypatch.setitem(sys.modules, name, m)

    class Signal:
        name = "fixture"
        default_weight = 1.0
        def __init__(self, name="fixture"):
            self.name = name
        def meta(self):
            return {"name": self.name, "version": "1", "category": "test"}

    async def stats(db):
        calls["eval"] += 1
        return {"fixture": {"5d": {"n": 4}}}

    class Broker:
        is_demo = True
        async def get_account(self):
            calls["broker"] += 1
            return SimpleNamespace(portfolio_value=100, equity=100, cash=100, buying_power=100)
        async def get_positions(self):
            calls["broker"] += 1
            return []

    module("api.routes.pipeline", _pipeline_running=False)
    registry = {name: Signal(name) for name in ["fixture"] + [f"unused{i}" for i in range(26)]}
    module("api.signals.registry", get_registry=lambda: registry)
    module("api.regime.detector", policy_for=lambda _: (0.75, {}))
    module("api.model.scorer", load_weights=lambda: {"fixture": 1.0})
    module("api.tracker.evaluator", get_signal_stats=stats)
    module("api.execution.alpaca_broker", AlpacaBroker=Broker)
    module("api.data.registry", get_sources=lambda: {})
    from api.routes.dashboard import get_dashboard_data, router

    async def exercise():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        queries = []
        event.listen(engine.sync_engine, "before_cursor_execute", lambda c, u, statement, *args: queries.append(statement))
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            db.add(PipelineRun(id="fixture-run", started_at=datetime(2024, 1, 1),
                               finished_at=datetime(2024, 1, 1, 0, 1), status="completed",
                               regime_id="risk_on", regime_confidence=.7, universe_size=2))
            for ticker in ("TEST", "MOCK"):
                db.add(SignalPrediction(run_id="fixture-run", run_date=date(2024, 1, 1),
                                        signal_name="fixture", ticker=ticker, score=.8, confidence=.9))
            await db.commit()
            cache.clear()
            queries.clear()
            overview = await get_dashboard_data(db, view="overview")
            assert calls == {"broker": 0, "eval": 0}
            assert overview["signals"][0]["prediction_count"] == 2
            assert len(overview["signals"]) == 27
            assert all(s["prediction_count"] == 0 for s in overview["signals"][1:])
            assert overview["portfolio"] == {"is_demo": True}
            assert "equity" not in overview["portfolio"]
            assert sum("count(" in q.lower() for q in queries) == 1
            query_count = len(queries)
            assert await get_dashboard_data(db, view="overview") == overview
            assert len(queries) == query_count
            full = await get_dashboard_data(db, view="full")
            assert calls == {"broker": 2, "eval": 1}
            for key in ("pipeline", "regime", "top_ideas", "recent_runs", "signal_groups"):
                assert full[key] == overview[key]
            assert full["portfolio"]["equity"] == 100
            assert full["signals"][0]["eval_stats"] == {"5d": {"n": 4}}
            assert await get_dashboard_data(db, view="overview") == overview
            assert calls == {"broker": 2, "eval": 1}
        cache.clear()
        await engine.dispose()

    asyncio.run(exercise())
    # FastAPI rejects unsupported views before touching the database.
    app = FastAPI()
    app.include_router(router)
    async def no_db():
        yield None
    app.dependency_overrides[get_db] = no_db
    with TestClient(app) as client:
        assert client.get('/api/dashboard-data?view=invalid').status_code == 422


def test_overview_uses_existing_auth_gate(monkeypatch):
    from api.auth import AuthMiddleware
    from api.config.settings import settings
    from api.routes.dashboard import router
    monkeypatch.setattr(settings, 'auth_password', 'synthetic-test-only')
    app = FastAPI()
    app.include_router(router)
    app.add_middleware(AuthMiddleware)
    with TestClient(app) as client:
        assert client.get('/api/dashboard-data?view=overview').status_code == 401
        assert client.get('/api/dashboard-data').status_code == 401
