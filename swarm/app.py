import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .engine import Engine
from .models import AGENTS, Disconnect, NewMission, ProviderKeys, UserMessage
from .providers import Providers
from .store import Store

ROOT = Path(__file__).resolve().parent


def create_app(data_dir=None, *, providers=None, demo_delay=0.8):
    store = Store(Path(data_dir or os.environ.get("SIGIL_SWARM_DATA_DIR", ROOT.parent / ".swarm" / "runtime")))
    provider_manager = providers or Providers()
    engine = Engine(store, provider_manager, demo_delay=demo_delay)

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.shutdown()
        for provider in ("gemini", "openai"):
            provider_manager.disconnect(provider)
        store.close()

    app = FastAPI(title="SIGIL Swarm", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store = store
    app.state.engine = engine
    app.state.providers = provider_manager
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def local_access(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            origin = request.headers.get("origin")
            expected = "http://" + request.headers.get("host", "")
            if origin and origin != expected:
                return JSONResponse({"detail": "Requests must come from this local dashboard."}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "Cross-site requests are not allowed."}, status_code=403)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"detail": "Use a JSON request from the dashboard."}, status_code=415)
            body = await request.body()
            if len(body) > 24000:
                return JSONResponse({"detail": "The request is too large."}, status_code=413)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
            "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        )
        return response

    @app.exception_handler(RequestValidationError)
    async def bad_request(request, exc):
        # Default validation responses include submitted inputs, which may be keys.
        fields = sorted({".".join(str(p) for p in e["loc"][1:]) for e in exc.errors()})
        return JSONResponse({"detail": "Check the submitted fields: " + ", ".join(fields)}, status_code=422)

    @app.exception_handler(ValueError)
    async def invalid_action(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"detail": "Mission not found."}, status_code=404)

    @app.get("/api/health")
    def health():
        return {"app": "sigil-swarm", "version": "0.1.0", "status": "ok"}

    @app.get("/api/state")
    def state():
        providers_status = provider_manager.public_status()
        with engine.lock:
            active_id = engine.active_id
        busy = set()
        if active_id:
            active = store.snapshot(active_id)
            busy = {t["agent_id"] for t in active["tasks"] if t["status"] == "running"}
            busy.update(c["agent_id"] for c in active["calls"] if c["status"] == "reserved")
        return {
            "app": {"name": "SIGIL Swarm", "version": "0.1.0"},
            "providers": providers_status, "budget": store.budget(),
            "agents": [{**a, "status": "working" if a["id"] in busy else "ready"} for a in AGENTS],
            "missions": store.summaries(), "active_mission_id": active_id,
            "backend": {"live_available": all(p["configured"] for p in providers_status.values()),
                        "worker_execution": "research_only", "search": "approved_source_urls",
                        "credentials": "session_only"},
        }

    @app.post("/api/providers")
    def configure(payload: ProviderKeys):
        with engine.lock:
            if engine.active_id:
                raise ValueError("Stop the current mission before changing API connections.")
            return provider_manager.configure(**payload.model_dump())

    @app.post("/api/providers/disconnect")
    def disconnect(payload: Disconnect):
        with engine.lock:
            if engine.active_id:
                raise ValueError("Stop the current mission before disconnecting a provider.")
            return provider_manager.disconnect(payload.provider)

    @app.post("/api/missions")
    def create(payload: NewMission):
        return store.create(payload.prompt, payload.mode)

    @app.get("/api/missions/{mission_id}")
    def detail(mission_id: str):
        return store.snapshot(mission_id)

    @app.post("/api/missions/{mission_id}/run")
    def run(mission_id: str):
        return engine.start(mission_id)

    @app.post("/api/missions/{mission_id}/stop")
    def stop(mission_id: str):
        return engine.stop(mission_id)

    @app.post("/api/missions/{mission_id}/messages")
    def message(mission_id: str, payload: UserMessage):
        if not payload.text.strip():
            raise ValueError("Write a message first.")
        with store.lock:
            data = store.get(mission_id)
            if data["mission"]["round"] >= data["mission"]["max_rounds"]:
                raise ValueError("This mission reached its round limit. Start a new mission with your follow-up.")
            result = store.message(mission_id, "user", payload.recipient, payload.text.strip(), "question")
            if data["mission"]["status"] not in ("running", "stopping"):
                data["mission"]["status"] = "ready"
                data["mission"]["summary"] = "Your follow-up is ready for the team."
                store.save(data)
            return {"message": result, "mission": store.snapshot(mission_id)["mission"]}

    @app.get("/api/missions/{mission_id}/export")
    def export(mission_id: str):
        data = store.snapshot(mission_id)
        m = data["mission"]
        lines = [
            "# " + m["title"], "", "Mode: " + ("SCRIPTED SAMPLE" if m["mode"] == "demo" else "API research"),
            "Status: " + m["status"], "Recorded model charges: $" + format(m["spent_usd"], ".6f"),
            "Research documents are unverified unless their evidence is independently checked.", "",
            "## Mission", m["prompt"], "", "## Conversation",
        ]
        for msg in data["messages"]:
            lines += ["", f"### {msg['sender']} → {msg['recipient']} · {msg['kind']}", msg["text"]]
        for a in data["artifacts"]:
            lines += ["", "## " + a["title"], "Evidence status: " + a["verification"], "", a["body"]]
            for s in a["sources"]:
                parsed = urlsplit(s.get("url", ""))
                if parsed.scheme == "https":
                    lines += [s.get("title", "Source") + ": " + s["url"]]
        return PlainTextResponse("\n".join(lines), media_type="text/markdown",
                                 headers={"Content-Disposition": f'attachment; filename="sigil-{mission_id}.md"'})

    @app.get("/")
    def index():
        return FileResponse(ROOT / "static" / "index.html")

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app
