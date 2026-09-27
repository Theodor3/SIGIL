import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.engine import Engine
from swarm.local import LOCAL_MODEL, LocalProvider
from swarm.models import Report, ToolRequest
from swarm.providers import ProviderFailure, ProviderResult, Providers
from swarm.store import BudgetError, Store
from swarm.studio import GitStudio


def report():
    return {"summary": "Fixture only", "artifact_title": "Fixture", "artifact_body": "Unvalidated fixture",
            "messages": [], "sources": [], "source_requests": [], "tool_requests": [], "studio_claims": []}


class LocalFixture(Providers):
    def __init__(self):
        super().__init__()
        self.local.status = lambda: {"configured": True, "verified": True, "model": LOCAL_MODEL}
        self.calls = []

    def run(self, provider, system, prompt, schema):
        assert provider == "local", "Local mission dispatched to a cloud provider"
        self.calls.append((system, json.loads(prompt)))
        return ProviderResult(json.dumps(report()), 25, 25, LOCAL_MODEL)


def test_local_mission_runs_after_paid_expiration_and_requires_review(tmp_path):
    store = Store(tmp_path)
    store.settings["expires_on"] = "2000-01-01"
    providers = LocalFixture()
    studio = GitStudio(Path(__file__).resolve().parents[2])
    engine = Engine(store, providers, studio=studio)
    mission = store.create("Inspect api/data/edgar.py and list available fields.", "local")
    before = store.budget()
    engine.start(mission["id"])
    engine.thread.join(10)
    assert not engine.thread.is_alive()
    result = store.snapshot(mission["id"])
    assert result["mission"]["status"] == "needs_review"
    assert len(providers.calls) == 2
    assert [c["provider"] for c in result["calls"]] == ["local", "local"]
    assert result["mission"]["specialist_execution"] == "sequential"
    assert result["mission"]["max_rounds"] == 1
    assert any(r["tool"] == "read_file" and r["status"] == "completed" for r in result["tool_results"])
    assert store.budget() == before
    with pytest.raises(ValueError):
        engine.start(mission["id"])
    store.close()


def test_no_paid_escape_or_local_relabel_and_local_call_cap(tmp_path):
    store = Store(tmp_path)
    local = store.create("Local", "local")["id"]
    paid = store.create("Paid", "live")["id"]
    with pytest.raises(BudgetError):
        store.reserve(local, "data", "gemini", "model", 0.1)
    with pytest.raises(BudgetError):
        store.reserve(paid, "data", "local", LOCAL_MODEL, 0)
    with pytest.raises(BudgetError):
        store.reserve(local, "data", "local", LOCAL_MODEL, 0.1)
    for _ in range(12):
        call = store.reserve(local, "data", "local", LOCAL_MODEL, 0)
        store.settle(call, cost=0)
    with pytest.raises(BudgetError):
        store.reserve(local, "data", "local", LOCAL_MODEL, 0)
    store.close()


def test_local_tools_block_outbound_requests(tmp_path, monkeypatch):
    from swarm.tooling import MissionTools
    store = Store(tmp_path)
    mission = store.create("Inspect source", "local")["id"]
    studio = GitStudio(Path(__file__).resolve().parents[2])
    tools = MissionTools(store, LocalFixture(), studio)
    for tool in ("web_search", "paper_search", "fetch_page"):
        result = tools.execute(mission, "data", ToolRequest(tool=tool, query="public research"), lambda: None)
        assert result["status"] == "blocked"
    store.close()


def test_interrupted_local_call_does_not_create_uncertain_paid_billing(tmp_path):
    store = Store(tmp_path)
    mid = store.create("Local", "local")["id"]
    store.reserve(mid, "data", "local", LOCAL_MODEL, 0)
    store.get(mid)["mission"]["status"] = "running"
    store.save(store.get(mid))
    store.close()
    store = Store(tmp_path)
    assert store.snapshot(mid)["calls"][0]["status"] == "failed"
    assert store.snapshot(mid)["mission"]["status"] == "blocked"
    assert not store.budget()["uncertain"]
    store.close()


@pytest.mark.parametrize("fault", [None, "model", "length", "schema", "usage", "redirect"])
def test_local_http_contract_and_fail_closed(monkeypatch, fault):
    real_client = httpx.Client
    seen = []

    def handle(request):
        seen.append(request)
        assert str(request.url) == "http://127.0.0.1:1234/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["response_format"]["json_schema"]["strict"] is True
        data = {"model": LOCAL_MODEL, "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(report())}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 30}}
        if fault == "model": data["model"] = "cloud-model"
        if fault == "length": data["choices"][0]["finish_reason"] = "length"
        if fault == "schema": data["choices"][0]["message"]["content"] = "{}"
        if fault == "usage": data["usage"]["prompt_tokens"] = -1
        if fault == "redirect": return httpx.Response(302, headers={"location": "https://example.com"})
        return httpx.Response(200, json=data)

    def client(**kwargs):
        assert kwargs["trust_env"] is False
        assert kwargs["follow_redirects"] is False
        return real_client(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr("swarm.local.httpx.Client", client)
    provider = LocalProvider()
    if fault:
        with pytest.raises(ProviderFailure): provider.run("system", "prompt", Report)
        assert not provider.verified
    else:
        result = provider.run("system", "prompt", Report)
        assert result.cost("local") == 0
        assert provider.verified
    assert len(seen) == 1


def test_local_api_mode_and_immutable_followups(tmp_path):
    app = create_app(tmp_path, providers=LocalFixture())
    headers = {"origin": "http://testserver"}
    with TestClient(app) as client:
        app.state.store.settings["expires_on"] = "2000-01-01"
        readiness = client.get("/api/readiness").json()
        assert readiness["can_start_local"]
        assert not readiness["can_start_live"]
        response = client.post("/api/missions", headers=headers, json={"prompt": "Inspect source", "mode": "local", "local_role": "engineering"})
        assert response.status_code == 200
        mission = response.json()
        assert mission["local_role"] == "engineering"
        app.state.store.get(mission["id"])["mission"]["status"] = "blocked"
        response = client.post(f'/api/missions/{mission["id"]}/messages', headers=headers, json={"text": "Replay"})
        assert response.status_code == 400


def test_external_review_is_local_only_and_once(tmp_path):
    app = create_app(tmp_path, providers=LocalFixture())
    with TestClient(app, headers={"origin": "http://testserver"}) as client:
        for mode in ("local", "live"):
            mid = client.post("/api/missions", json={"prompt": "Inspect source", "mode": mode}).json()["id"]
            record = app.state.store.get(mid)
            record["mission"]["status"] = "needs_review"
            app.state.store.save(record)
            payload = {"accepted": True, "reviewer": "codex", "note": "Checked against the exact pinned source; scope is limited to this path."}
            response = client.post(f"/api/missions/{mid}/review", json=payload)
            assert response.status_code == (200 if mode == "local" else 400)
            if mode == "local":
                assert response.json()["status"] == "completed"
                assert client.post(f"/api/missions/{mid}/review", json=payload).status_code == 400
