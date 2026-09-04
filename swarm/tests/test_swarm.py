import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.engine import Engine, RULES
from swarm.models import AGENT_MAP, GEMINI_MODEL, OPENAI_MODEL, Plan, Report, Verdict
from swarm.providers import ProviderFailure, ProviderResult, Providers
from swarm.sources import validate_url
from swarm.store import BudgetError, Store


class FakeProviders(Providers):
    """Protocol fixtures. Never call any network or model API."""

    def __init__(self, *, peer_request=True):
        super().__init__()
        self.keys = {"openai": "fixture", "gemini": "fixture"}
        self.calls = []
        self.peer_request = peer_request
        self.hook = None

    def run(self, provider, system, prompt, schema):
        context = json.loads(prompt)
        agent = next(a["id"] for a in AGENT_MAP.values() if "Your role: " + a["role"] in system)
        with self.lock:
            self.calls.append((agent, schema.__name__, context))
            number = sum(1 for x in self.calls if x[0] == agent)
        if self.hook:
            self.hook(agent, schema, context)
        if schema is Plan:
            payload = {"message": "Fixture plan", "assignments": [
                {"agent_id": "research-events", "task": "Define the idea"},
                {"agent_id": "data", "task": "Check available data"},
            ]}
        elif schema is Report:
            messages = []
            if agent == "research-events" and number == 1 and self.peer_request:
                messages = [{"recipient": "data", "kind": "request", "text": "Which timestamp is actually observable?"}]
            payload = {"summary": "Fixture " + agent, "artifact_title": agent + " brief",
                       "artifact_body": "This is a test fixture, not an observed research result.",
                       "messages": messages, "sources": [], "source_requests": []}
        else:
            payload = {"message": "Fixture review; no real signal was tested.", "outcome": "ready_for_user", "assignments": []}
        return ProviderResult(json.dumps(payload), 100, 100,
                              OPENAI_MODEL if provider == "openai" else GEMINI_MODEL, "fixture-response")


def join(engine):
    engine.thread.join(timeout=8)
    assert not engine.thread.is_alive(), "Fixture runner did not stop"


@pytest.fixture
def store(tmp_path):
    instance = Store(tmp_path)
    yield instance
    instance.close()


def test_budget_reservations_are_atomic(store):
    mid = store.create("Test", "live")["id"]
    def reserve():
        try:
            return store.reserve(mid, "data", "gemini", GEMINI_MODEL, 0.60)
        except BudgetError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert sum(r is not None for r in results) == 1
    assert store.budget()["remaining_today_usd"] == 0.4
    store.settle(next(r for r in results if r), cost=0.10)
    assert store.budget()["remaining_today_usd"] == 0.9


def test_budget_and_uncertainty_survive_restart(tmp_path):
    first = Store(tmp_path)
    mid = first.create("Interrupted", "live")["id"]
    first.get(mid)["mission"]["status"] = "running"
    first.save(first.get(mid))
    first.reserve(mid, "data", "gemini", GEMINI_MODEL, 0.2)
    first.close()
    second = Store(tmp_path)
    try:
        assert second.budget()["uncertain"]
        assert second.snapshot(mid)["mission"]["status"] == "blocked"
        with pytest.raises(BudgetError, match="uncertain"):
            second.reserve(mid, "data", "gemini", GEMINI_MODEL, 0.1)
    finally:
        second.close()


def test_second_controller_cannot_share_budget(store):
    with pytest.raises(RuntimeError, match="Another"):
        Store(store.root)


def test_demo_has_no_provider_calls_and_exports(tmp_path):
    providers = FakeProviders()
    app = create_app(tmp_path, providers=providers, demo_delay=0)
    with TestClient(app) as client:
        created = client.post("/api/missions", json={"prompt": "Sample: test one unusual idea", "mode": "demo"}).json()
        assert client.post(f"/api/missions/{created['id']}/run", json={}).status_code == 200
        join(app.state.engine)
        data = client.get(f"/api/missions/{created['id']}").json()
        assert data["mission"]["status"] == "completed"
        assert data["mission"]["spent_usd"] == 0
        assert all(a["verification"] == "sample" for a in data["artifacts"])
        assert not providers.calls
        exported = client.get(f"/api/missions/{created['id']}/export")
        assert "SCRIPTED SAMPLE" in exported.text
        assert "attachment" in exported.headers["content-disposition"]
        assert client.get("/api/state").json()["budget"]["today_usd"] == 0


def test_peer_question_reaches_the_addressed_worker(store):
    providers = FakeProviders()
    engine = Engine(store, providers)
    mid = store.create("Find an unusual signal hypothesis", "live")["id"]
    engine.start(mid)
    join(engine)
    assert store.snapshot(mid)["mission"]["status"] == "completed"
    data_contexts = [c for agent, _, c in providers.calls if agent == "data"]
    assert any(any("Which timestamp" in m["text"] for m in c["messages_addressed_to_you"]) for c in data_contexts)
    assert any(m["handled"] for m in store.snapshot(mid)["messages"] if "Which timestamp" in m["text"])
    reviews = [c for agent, _, c in providers.calls if agent == "review"]
    assert reviews[0]["relevant_artifacts"] == []
    assert reviews[1]["relevant_artifacts"]


def test_full_document_tail_and_all_authors_reach_reviewer(store):
    mid = store.create("Read whole documents", "live")["id"]
    for index, agent in enumerate(a for a in AGENT_MAP if a not in ("coordinator", "review")):
        store.artifact(mid, agent, agent, "a" * 3500 + f" CRITICAL_TAIL_{index}")
    engine = Engine(store, FakeProviders())
    prompt, _ = engine._context(mid, "review", "Review complete artifacts")
    context = json.loads(prompt)
    assert len(context["relevant_artifacts"]) == 6
    assert all("CRITICAL_TAIL_" in a["body"] for a in context["relevant_artifacts"])


def test_direct_user_followup_is_not_consumed_by_planner(store):
    providers = FakeProviders(peer_request=False)
    engine = Engine(store, providers)
    mid = store.create("A mission", "live")["id"]
    question = store.message(mid, "user", "quant", "Please define the null hypothesis.", "question")
    engine.start(mid)
    join(engine)
    assert any(agent == "quant" and any(m["id"] == question["id"] for m in c["messages_addressed_to_you"])
               for agent, _, c in providers.calls)
    assert next(m for m in store.snapshot(mid)["messages"] if m["id"] == question["id"])["handled"]


def test_late_user_message_is_not_acknowledged_by_old_context(store):
    providers = FakeProviders(peer_request=False)
    engine = Engine(store, providers)
    mid = store.create("A mission", "live")["id"]
    injected = []
    def hook(agent, schema, context):
        if schema is Verdict and not injected:
            injected.append(store.message(mid, "user", "coordinator", "Also explain the missing-data policy.", "question"))
    providers.hook = hook
    engine.start(mid)
    join(engine)
    assert len([c for a, s, c in providers.calls if s == "Verdict"]) >= 2
    assert next(m for m in store.snapshot(mid)["messages"] if m["id"] == injected[0]["id"])["handled"]


def test_pending_queue_is_not_erased_by_inspection_or_peer_cap(store):
    mid = store.create("A mission", "live")["id"]
    msg = store.message(mid, "review", "quant", "Unresolved objection", "challenge")
    store.get(mid)["mission"]["peer_rounds"] = 2
    engine = Engine(store, FakeProviders())
    assert engine._pending(mid)
    assert not next(m for m in store.snapshot(mid)["messages"] if m["id"] == msg["id"])["handled"]


def test_unexpected_model_retains_billing_reservation(store):
    providers = FakeProviders()
    providers.run = lambda *args: ProviderResult('{"message":"x","assignments":[]}', 100, 100, "unexpected-expensive-model", "response-42")
    mid = store.create("A mission", "live")["id"]
    with pytest.raises(ProviderFailure, match="different"):
        Engine(store, providers)._call(mid, "coordinator", "Plan", Plan)
    assert store.budget()["uncertain"]
    call = store.ledger[0]
    assert call["cost_usd"] == 0
    assert call["response_id"] == "response-42"
    assert call["returned_model"] == "unexpected-expensive-model"


def test_invalid_json_still_records_provider_usage(store):
    providers = FakeProviders()
    providers.run = lambda *args: ProviderResult("truncated", 100, 100, OPENAI_MODEL)
    mid = store.create("A mission", "live")["id"]
    with pytest.raises(ValueError, match="incomplete"):
        Engine(store, providers)._call(mid, "coordinator", "Plan", Plan)
    assert store.budget()["today_usd"] > 0
    assert not store.budget()["uncertain"]


def test_provider_failure_stops_without_retry(store):
    providers = FakeProviders()
    attempts = []
    def fail(*args):
        attempts.append(1)
        raise ProviderFailure("Network result unknown")
    providers.run = fail
    mid = store.create("A mission", "live")["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    assert attempts == [1]
    assert store.snapshot(mid)["mission"]["status"] == "blocked"
    assert store.budget()["uncertain"]


def test_stop_during_call_prevents_next_dispatch(store):
    providers = FakeProviders()
    entered = threading.Event()
    release = threading.Event()
    def wait(*args):
        entered.set()
        release.wait(timeout=3)
    providers.hook = wait
    mid = store.create("A mission", "live")["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    assert entered.wait(timeout=2)
    engine.stop(mid)
    release.set()
    join(engine)
    assert len(providers.calls) == 1
    assert store.snapshot(mid)["mission"]["status"] == "stopped"


def test_local_api_guards_and_secret_redaction(tmp_path):
    providers = Providers()
    providers.keys = {"gemini": "", "openai": ""}
    app = create_app(tmp_path, providers=providers)
    with TestClient(app) as client:
        response = client.post("/api/providers", json={"gemini_api_key": "secret-fixture-key"}, headers={"Origin": "https://evil.invalid"})
        assert response.status_code == 403
        response = client.post("/api/providers", json={"gemini_api_key": "secret-fixture-key"})
        assert response.status_code == 200
        assert "secret-fixture-key" not in response.text
        response = client.post("/api/providers", json={"openai_api_key": "sk-secret-fixture-" * 100})
        assert response.status_code == 422
        assert "sk-secret" not in response.text
        state = client.get("/api/state")
        assert "secret-fixture-key" not in state.text
        assert not state.json()["providers"]["gemini"]["verified"]
        mission = client.post("/api/missions", json={"prompt": "An API task", "mode": "live"}).json()
        assert client.post(f"/api/missions/{mission['id']}/run", json={}).status_code == 400
        assert client.get("/api/state", headers={"Host": "attacker.invalid"}).status_code == 400
    assert not any("secret-fixture" in p.read_text(encoding="utf-8", errors="ignore")
                   for p in tmp_path.glob("*.json*"))


@pytest.mark.parametrize("url", [
    "http://www.sec.gov/a", "https://localhost/a", "https://127.0.0.1/a",
    "https://www.sec.gov.evil.invalid/a", "https://user@www.sec.gov/a", "https://www.sec.gov:8443/a",
])
def test_public_source_boundary(url):
    with pytest.raises(ValueError):
        validate_url(url, resolve=False)
