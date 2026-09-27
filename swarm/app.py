import hashlib
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .engine import Engine
from .models import AGENTS, Disconnect, NewMission, ProviderKeys, UserMessage
from .providers import Providers
from .store import Store, now
from .studio import GitStudio

ROOT = Path(__file__).resolve().parent


def create_app(data_dir=None, *, providers=None, demo_delay=0.8, studio=None):
    store = Store(Path(data_dir or os.environ.get("SIGIL_SWARM_DATA_DIR", ROOT.parent / ".swarm" / "runtime")))
    provider_manager = providers or Providers()
    studio = studio or GitStudio(ROOT.parent)
    engine = Engine(store, provider_manager, demo_delay=demo_delay, studio=studio)
    started_at = now()

    @asynccontextmanager
    async def lifespan(app):
        yield
        stopped = engine.shutdown()
        if stopped:
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
            if origin != expected:
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

    def runtime_status(providers_status=None):
        providers_status = providers_status or provider_manager.public_status()
        budget = store.budget()
        manifest = studio.manifest()
        with engine.lock:
            active_id = engine.active_id
        summaries = store.summaries()
        missing = [name for name, value in providers_status.items() if not value["configured"]]
        blockers = []
        if active_id:
            blockers.append({"code": "mission_running", "message": "A mission is already running.", "action": "open_active_mission"})
        if not manifest.get("is_current", True):
            blockers.append({"code": "studio_stale", "message": "The dashboard needs a safe restart to load the latest development commit.", "action": "restart_dashboard"})
        if missing:
            labels = ["OpenAI" if name == "openai" else "Gemini" for name in missing]
            blockers.append({"code": "providers_missing", "message": "Reconnect " + " and ".join(labels) + " before API research can run.", "action": "connect_providers"})
        if budget["uncertain"]:
            blockers.append({"code": "billing_uncertain", "message": "An API call has uncertain billing and must be reviewed before another paid call.", "action": "review_api_calls"})
        if budget["expired"]:
            blockers.append({"code": "pilot_expired", "message": "The seven-day pilot has ended.", "action": "review_pilot"})
        elif min(budget["remaining_today_usd"], budget["remaining_pilot_usd"]) <= 0:
            blockers.append({"code": "budget_exhausted", "message": "The current API allowance is exhausted.", "action": "review_budget"})

        warnings = []
        unverified = [name for name, value in providers_status.items() if value["configured"] and not value["verified"]]
        if unverified:
            warnings.append({"code": "access_unverified", "message": "Connected provider access will be verified by the first model call."})
        if not manifest.get("capabilities", {}).get("execution"):
            warnings.append({"code": "execution_unavailable", "message": "Container-backed code execution is unavailable; research and draft review still work."})

        attention_count = sum(m["status"] in ("needs_review", "blocked") for m in summaries)
        review_count = sum(m["status"] == "needs_review" for m in summaries)
        if active_id:
            status, label = "working", "Mission in progress"
        elif any(item["code"] == "studio_stale" for item in blockers):
            status, label = "restart_required", "Safe restart needed"
        elif budget["uncertain"]:
            status, label = "budget_review", "API call review needed"
        elif budget["expired"]:
            status, label = "pilot_ended", "Pilot ended"
        elif missing:
            status, label = "waiting_for_connections", "Reconnect APIs"
        elif blockers:
            status, label = "paused", "API work paused"
        elif review_count:
            status, label = "ready_with_review", "Ready · results to review"
        else:
            status, label = "ready", "Ready for a mission"
        return {
            "status": status, "label": label, "can_start_live": not blockers,
            "can_start_local": not active_id and manifest.get("is_current", True) and provider_manager.local.status()["configured"],
            "blockers": blockers, "warnings": warnings,
            "scheduler_enabled": False, "scheduler_mode": "manual",
            "cadence_minutes": 1440, "max_mission_minutes": 20, "credentials_persist": False,
            "attention_count": attention_count, "review_count": review_count,
            "last_mission_at": summaries[0]["updated_at"] if summaries else None,
            "studio_current": manifest.get("is_current", True),
            "studio_commit": manifest.get("commit"), "current_head": manifest.get("current_head"),
            "storage": store.runtime_identity(),
        }

    def mission_view(mission, runtime):
        result = dict(mission)
        status = result.get("status")
        result["status_reason"] = result.get("summary") or ""
        result["retryable"] = False
        if result.get("round", 0) >= result.get("max_rounds", 5):
            result["required_action"] = "start_focused_followup"
        elif status == "needs_review":
            result["required_action"] = "review_evidence"
        elif status in ("running", "stopping"):
            result["required_action"] = "wait_for_mission"
        elif status == "completed":
            result["required_action"] = "review_evidence"
        elif status == "blocked":
            if result.get("mode") in ("live", "local"):
                result["required_action"] = (runtime["blockers"][0]["action"] if runtime["blockers"] else "start_focused_followup")
            else:
                result["required_action"] = "start_mission"
                result["retryable"] = True
        elif status == "stopped" and result.get("mode") in ("live", "local"):
            result["required_action"] = "start_focused_followup"
        else:
            result["required_action"] = "start_mission"
            result["retryable"] = runtime["can_start_live"] or result.get("mode") == "demo"
            if result.get("mode") == "local":
                result["retryable"] = status == "ready" and runtime["can_start_local"]
        result["evidence_status"] = "workflow_complete_unvalidated" if status == "completed" and result.get("mode") == "live" else "not_validated"
        return result

    @app.get("/api/health")
    def health():
        manifest = studio.manifest()
        return {"app": "sigil-swarm", "version": __version__, "status": "ok",
                "started_at": started_at, "pid": os.getpid(),
                "workspace": str(studio.root), "branch": manifest["branch"],
                "studio_commit": manifest["commit"], "studio_current": manifest.get("is_current", True),
                "storage": store.runtime_identity()}

    @app.get("/api/readiness")
    def readiness():
        return runtime_status()

    @app.get("/api/state")
    def state():
        providers_status = provider_manager.public_status()
        runtime = runtime_status(providers_status)
        with engine.lock:
            active_id = engine.active_id
        busy = set()
        if active_id:
            active = store.snapshot(active_id)
            busy = {t["agent_id"] for t in active["tasks"] if t["status"] == "running"}
            busy.update(c["agent_id"] for c in active["calls"] if c["status"] == "reserved")
        summaries = [mission_view(mission, runtime) for mission in store.summaries()]
        local_status = provider_manager.local.status()
        agents = []
        for original in AGENTS:
            agent = dict(original)
            if active_id and active["mission"]["mode"] == "local" and agent["id"] in active.get("participants", []):
                agent.update(provider="LM Studio (local)", model=local_status["model"])
                agent["status"] = "working" if agent["id"] in busy else "ready"
            else:
                connection = providers_status["openai" if agent["id"] == "coordinator" else "gemini"]
                agent["status"] = "working" if agent["id"] in busy else "offline" if not connection["configured"] else "ready" if connection["verified"] else "unverified"
            agents.append(agent)
        return {
            "app": {"name": "SIGIL Swarm", "version": __version__},
            "providers": providers_status, "budget": store.budget(),
            "local_provider": local_status,
            "agents": agents,
            "missions": summaries, "active_mission_id": active_id, "runtime": runtime,
            "backend": {"live_available": runtime["can_start_live"],
                         "worker_execution": "development_studio", "search": "web_and_papers",
                         "credentials": "session_only"},
        }

    @app.get("/api/studio")
    def studio_manifest():
        return studio.manifest()

    @app.get("/api/studio/file")
    def studio_file(path: str = Query(max_length=240), start: int = Query(default=1, ge=1, le=100000)):
        return studio.read(path, start=start)

    @app.get("/api/studio/search")
    def studio_search(q: str = Query(min_length=1, max_length=400)):
        return studio.search(q)

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
        return store.create(
            payload.prompt, payload.mode, max_revisions=payload.max_revisions,
            specialist_execution=payload.specialist_execution,
            local_role=payload.local_role,
        )

    @app.get("/api/missions/{mission_id}")
    def detail(mission_id: str):
        data = store.snapshot(mission_id)
        data["mission"] = mission_view(data["mission"], runtime_status())
        data["evidence_summary"] = {
            "validated_signals": 0,
            "unverified_artifacts": sum(a.get("verification") == "unverified" for a in data["artifacts"]),
            "review_documents": sum(a.get("author") in ("review", "coordinator") for a in data["artifacts"]),
        }
        return data

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
            if data["mission"]["mode"] in ("live", "local") and data["mission"]["status"] not in ("ready", "running", "stopping"):
                raise ValueError("Keep this run as an immutable record. Start a focused follow-up mission so prior API calls are not replayed.")
            result = store.message(mission_id, "user", payload.recipient, payload.text.strip(), "question")
            if data["mission"]["status"] not in ("running", "stopping"):
                data["mission"]["status"] = "ready"
                data["mission"]["summary"] = "Your follow-up is ready for the team."
                store.save(data)
            return {"message": result, "mission": store.snapshot(mission_id)["mission"]}

    @app.get("/api/missions/{mission_id}/export")
    def export(mission_id: str):
        data = store.snapshot(mission_id)
        m = mission_view(data["mission"], runtime_status())
        lines = [
            "# " + m["title"], "", "Mode: " + ({"demo": "SCRIPTED SAMPLE", "local": "Local model; coordinator review required", "live": "API research"}[m["mode"]]),
            "Status: " + m["status"], "Estimated model/tool cost: $" + format(m["spent_usd"], ".6f"),
            "Evidence status: no trading signal was validated by this workflow.",
            "Research documents are unverified unless their evidence is independently checked.", "",
            "## Run record",
            "Required action: " + m["required_action"],
            "Specialists: " + (", ".join(p for p in data.get("participants", []) if p != "review") or "not assigned"),
            "Studio commit: " + ((data.get("studio") or {}).get("commit") or "not pinned"),
            "Studio branch: " + ((data.get("studio") or {}).get("branch") or "not pinned"),
            "", "## Mission", m["prompt"], "", "## Conversation",
        ]
        for msg in data["messages"]:
            lines += ["", f"### {msg['sender']} → {msg['recipient']} · {msg['kind']}", msg["text"]]
        for a in data["artifacts"]:
            lines += [
                "", "## " + a["title"],
                "Evidence status: " + a["verification"],
                "Studio provenance: " + a.get("provenance_status", "none"),
                "", a["body"],
            ]
            if a.get("studio_claims"):
                lines += ["", "Structured Studio claim bindings:"]
                for claim in a["studio_claims"]:
                    lines.append(f"- {claim.get('field', 'Claim')} · {claim.get('status', 'unverified')}")
                    for evidence in claim.get("evidence", []):
                        lines.append(
                            f"  - {evidence.get('path', 'unknown')}:{evidence.get('start', '?')}-{evidence.get('end', '?')} "
                            f"· SHA-256 {evidence.get('sha256', 'unavailable')} "
                            f"· commit {evidence.get('commit', 'unavailable')} "
                            f"· tool record {evidence.get('tool_result_id', 'unavailable')}"
                        )
            for s in a["sources"]:
                parsed = urlsplit(s.get("url", ""))
                if parsed.scheme == "https":
                    lines += [s.get("title", "Source") + ": " + s["url"]]
        for draft in data.get("drafts", []):
            content_hash = draft.get("content_sha256") or hashlib.sha256(draft.get("content", "").encode("utf-8")).hexdigest()
            lines += ["", "## Draft: " + draft["path"], "Not applied to the project.",
                      "Draft ID: " + draft["id"], "Source commit: " + draft.get("commit", "unavailable"),
                      "Original SHA-256: " + (draft.get("before_sha256") or "new file"),
                      "Draft SHA-256: " + content_hash, "```diff", draft["diff"], "```"]
        for result in data.get("tool_results", []):
            lines += ["", "## Tool: " + result["tool"], "Status: " + result["status"],
                      "Task ID: " + (result.get("task_id") or "legacy record"), result["summary"]]
            checked = result.get("result", {}).get("checked_drafts", [])
            for item in checked:
                lines.append("Checked draft: " + item.get("id", "unknown") + " · " + item.get("path", "unknown") + " · SHA-256 " + item.get("sha256", "unknown"))
        lines += ["", "## Provider call ledger"]
        if not data.get("calls"):
            lines.append("No provider calls were recorded.")
        for call in data.get("calls", []):
            usage = json.dumps(call.get("usage"), sort_keys=True) if call.get("usage") is not None else "unavailable"
            lines += ["", "### " + call["id"],
                      "Agent/provider: " + call.get("agent_id", "unknown") + " / " + call.get("provider", "unknown"),
                      "Task ID: " + (call.get("task_id") or "mission-level call"),
                      "Requested model: " + call.get("model", "unknown"),
                      "Returned model: " + (call.get("returned_model") or "unavailable"),
                      "Status: " + call.get("status", "unknown"),
                      "Reservation: $" + format(call.get("reservation_usd", 0), ".6f"),
                      "Estimated cost: $" + format(call.get("cost_usd", 0), ".6f"),
                      "Usage: " + usage]
            if call.get("error"):
                lines.append("Recorded error: " + call["error"])
        return PlainTextResponse("\n".join(lines), media_type="text/markdown",
                                 headers={"Content-Disposition": f'attachment; filename="sigil-{mission_id}.md"'})

    @app.get("/")
    def index():
        return FileResponse(ROOT / "static" / "index.html")

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app
