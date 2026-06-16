from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.db import engine
from api.db.models import Base
from api.routes.dashboard import router as dashboard_router
from api.signals.registry import discover_signals


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    discover_signals()
    yield


app = FastAPI(title="Sigil V2", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard_router)


@app.get("/health")
async def health():
    from api.signals.registry import get_registry
    signals = get_registry()
    return {
        "status": "healthy",
        "version": "0.1.0",
        "signals_loaded": len(signals),
        "signal_names": list(signals.keys()),
    }
