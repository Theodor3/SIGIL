import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from swarm import __version__
from swarm.app import create_app
from swarm.engine import Engine, RULES
from swarm.models import AGENT_MAP, GEMINI_MODEL, OPENAI_MODEL, Plan, Report, Verdict
from swarm.providers import ProviderFailure, ProviderResult, Providers
from swarm.sources import validate_url
from swarm.store import BudgetError, Store


def test_launcher_version_matches_application_version():
    launcher = Path(__file__).parents[1] / "scripts" / "Start Swarm.ps1"
    match = re.search(r"\$expectedVersion = '([^']+)'", launcher.read_text(encoding="utf-8"))
    assert match and match.group(1) == __version__


class FakeProviders(Providers):
    """Protocol fixtures. Never call any network or model API."""

    def __init__(self, *, peer_request=True):
        super().__init__()
        self.keys = {"openai": "fixture", "gemini": "fixture"}
        self.calls = []
        self.peer_request = peer_request
        self.hook = None

    def check_gemini_model(self):
        pass

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
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
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


def test_controller_enforces_two_specialist_membership(store):
    class OverstaffedPlan(FakeProviders):
        def run(self, provider, system, prompt, schema):
            result = super().run(provider, system, prompt, schema)
            if schema is Plan:
                payload = {
                    "message": "Use every role",
                    "assignments": [
                        {"agent_id": role, "task": "Inspect one bounded question"}
                        for role in ("research-events", "data", "quant", "engineering", "product-ops")
                    ],
                }
                result.text = json.dumps(payload)
            return result

    providers = OverstaffedPlan(peer_request=False)
    mid = store.create("Use a small research team", "live")["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    data = store.snapshot(mid)
    assert set(data["participants"]) == {"review", "research-events", "data"}
    worker_roles = {agent for agent, schema, _ in providers.calls if schema == "Report" and agent != "review"}
    assert worker_roles == {"research-events", "data"}
    assert any(message["kind"] == "scope" and "limited" in message["text"] for message in data["messages"])


def test_structured_revision_limit_prevents_an_extra_batch(store):
    class AlwaysRevise(FakeProviders):
        def run(self, provider, system, prompt, schema):
            result = super().run(provider, system, prompt, schema)
            if schema is Verdict:
                result.text = json.dumps({
                    "message": "One more revision would help.",
                    "outcome": "revise",
                    "assignments": [
                        {"agent_id": "research-events", "task": "Revise the idea."},
                        {"agent_id": "data", "task": "Revise the data check."},
                    ],
                })
            return result

    providers = AlwaysRevise(peer_request=False)
    mid = store.create("Allow exactly one revision", "live", max_revisions=1)["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    data = store.snapshot(mid)
    assert data["mission"]["round"] == 2
    assert data["mission"]["max_revisions"] == 1
    assert data["mission"]["max_rounds"] == 2
    assert data["mission"]["status"] == "needs_review"
    assert not any(task["round"] == 3 for task in data["tasks"])


def test_sequential_specialists_receive_prior_peer_handoff(store):
    observed = []

    class SequentialHandoff(FakeProviders):
        def run(self, provider, system, prompt, schema):
            result = super().run(provider, system, prompt, schema)
            context = json.loads(prompt)
            agent = next(a["id"] for a in AGENT_MAP.values() if "Your role: " + a["role"] in system)
            if schema is Plan:
                result.text = json.dumps({
                    "message": "Run a source handoff.",
                    "assignments": [
                        {"agent_id": "engineering", "task": "Inspect the source first."},
                        {"agent_id": "quant", "task": "Use the engineering handoff."},
                    ],
                })
            elif schema is Report and agent == "engineering":
                payload = json.loads(result.text)
                payload["messages"] = [{
                    "recipient": "quant", "kind": "finding", "text": "SOURCE_READY",
                }]
                result.text = json.dumps(payload)
            elif schema is Report and agent == "quant" and "Use the engineering handoff" in context["your_task"]:
                if any(message["text"] == "SOURCE_READY" for message in context["messages_addressed_to_you"]):
                    observed.append("SOURCE_READY")
            return result

    providers = SequentialHandoff(peer_request=False)
    mid = store.create(
        "Run the workers in evidence order", "live", max_revisions=0,
        specialist_execution="sequential",
    )["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    mission = store.snapshot(mid)["mission"]
    assert mission["specialist_execution"] == "sequential"
    assert mission["status"] == "completed"
    assert observed == ["SOURCE_READY"]


def test_api_validates_structured_mission_controls(tmp_path):
    app = create_app(tmp_path, providers=FakeProviders(), demo_delay=0)
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        created = client.post("/api/missions", json={
            "prompt": "One bounded pass", "mode": "live", "max_revisions": 1,
            "specialist_execution": "sequential",
        })
        assert created.status_code == 200
        assert created.json()["max_rounds"] == 2
        assert created.json()["specialist_execution"] == "sequential"
        defaulted = client.post("/api/missions", json={
            "prompt": "Default bounded pass", "mode": "live",
        })
        assert defaulted.status_code == 200
        assert defaulted.json()["max_rounds"] == 2
        assert client.post("/api/missions", json={
            "prompt": "Invalid", "mode": "live", "max_revisions": -1,
        }).status_code == 422
        assert client.post("/api/missions", json={
            "prompt": "Invalid", "mode": "live", "max_revisions": 5,
        }).status_code == 422


def test_out_of_scope_peer_request_forces_review_instead_of_disappearing(store):
    class OutOfScopeRequest(FakeProviders):
        def run(self, provider, system, prompt, schema):
            result = super().run(provider, system, prompt, schema)
            context = json.loads(prompt)
            if schema is Report and "Define the idea" in context["your_task"]:
                payload = json.loads(result.text)
                payload["messages"] = [{
                    "recipient": "engineering", "kind": "request",
                    "text": "Please inspect an implementation detail.",
                }]
                result.text = json.dumps(payload)
            return result

    providers = OutOfScopeRequest(peer_request=False)
    mid = store.create("Keep role requests auditable", "live")["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    data = store.snapshot(mid)
    assert data["mission"]["status"] == "needs_review"
    assert "outside this mission" in data["mission"]["summary"]
    assert any(message["kind"] == "scope" and "engineering" in message["text"] for message in data["messages"])


def test_full_document_tail_and_all_authors_reach_reviewer(store):
    mid = store.create("Read whole documents", "live")["id"]
    for index, agent in enumerate(a for a in AGENT_MAP if a not in ("coordinator", "review")):
        store.artifact(mid, agent, agent, "a" * 3500 + f" CRITICAL_TAIL_{index}")
    engine = Engine(store, FakeProviders())
    prompt, _ = engine._context(mid, "review", "Review complete artifacts")
    context = json.loads(prompt)
    assert len(context["relevant_artifacts"]) == 6
    assert all("CRITICAL_TAIL_" in a["body"] for a in context["relevant_artifacts"])


def test_structured_studio_claims_render_exact_controller_provenance(store):
    mid = store.create("Preserve exact source evidence", "live")["id"]
    store.get(mid)["studio"] = {"commit": "b" * 40, "files": ["api/data/edgar.py"]}
    store.get(mid)["tool_results"] = [{
        "id": "tool_exact", "task_id": "task_exact", "agent_id": "engineering",
        "tool": "read_file", "status": "completed", "summary": "read",
        "result": {
            "path": "api/data/edgar.py", "start": 1, "end": 113, "total_lines": 113,
            "text": "dates = recent.get('filingDate', [])", "sha256": "a" * 64,
            "commit": "b" * 40, "line_truncated": False,
            "text_truncated": False, "complete_file": True,
        },
    }]
    engine = Engine(store, FakeProviders())
    report = Report(
        summary="Filing date is present.", artifact_title="Field matrix",
        artifact_body="Model copy: SHA aaaaa... and absent evidence N/A.", messages=[], sources=[],
        source_requests=[], tool_requests=[], studio_claims=[
            {"field": "Filing date", "status": "present", "observation": "A filingDate list is read.",
             "consequence": "Daily event ordering is possible.", "tool_result_ids": ["tool_exact"]},
            {"field": "Acceptance datetime", "status": "absent", "observation": "No such field is read.",
             "consequence": "Intraday point-in-time ordering is unavailable.", "tool_result_ids": ["tool_exact"]},
        ],
    )
    engine._record_report(mid, "engineering", report, [], task_id="task_exact")
    artifact = store.snapshot(mid)["artifacts"][-1]
    evidence = artifact["studio_claims"][0]["evidence"]
    assert artifact["provenance_status"] == "source_linked"
    assert "aaaaa..." not in artifact["body"]
    assert "N/A" not in artifact["body"]
    assert "a" * 64 in artifact["body"]
    assert evidence == [{
        "tool_result_id": "tool_exact", "task_id": "task_exact", "agent_id": "engineering",
        "path": "api/data/edgar.py", "start": 1, "end": 113, "total_lines": 113,
        "sha256": "a" * 64, "commit": "b" * 40,
        "complete_file": True, "line_truncated": False, "text_truncated": False,
    }]
    prompt, _ = engine._context(mid, "review", "Review the artifact")
    assert json.loads(prompt)["relevant_artifacts"][-1]["studio_claims"] == artifact["studio_claims"]


@pytest.mark.parametrize("case", [
    "unknown_id", "failed", "wrong_tool", "nonhex_hash", "wrong_commit",
    "invalid_range", "parallel_cross_agent", "partial_absence",
])
def test_invalid_studio_claim_links_never_become_source_linked(store, case):
    mid = store.create("Reject bad source links", "live")["id"]
    store.get(mid)["studio"] = {"commit": "b" * 40, "files": ["api/data/edgar.py"]}
    record = {
        "id": "tool_exact", "task_id": "task_exact", "agent_id": "engineering",
        "tool": "read_file", "status": "completed", "summary": "read",
        "result": {"path": "api/data/edgar.py", "start": 1, "end": 10, "total_lines": 10,
                   "text": "source", "sha256": "a" * 64, "commit": "b" * 40,
                   "line_truncated": False, "text_truncated": False, "complete_file": True},
    }
    claim_id = "tool_exact"
    if case == "unknown_id":
        claim_id = "missing"
    elif case == "failed":
        record["status"] = "failed"
    elif case == "wrong_tool":
        record["tool"] = "search_code"
    elif case == "nonhex_hash":
        record["result"]["sha256"] = "z" * 64
    elif case == "wrong_commit":
        record["result"]["commit"] = "c" * 40
    elif case == "invalid_range":
        record["result"].update(start=9, end=1)
    elif case == "parallel_cross_agent":
        record["agent_id"] = "data"
    elif case == "partial_absence":
        record["result"]["start"] = 2
    store.get(mid)["tool_results"] = [record]
    report = Report(
        summary="Claim", artifact_title="Claim", artifact_body="This must be withheld.",
        messages=[], sources=[], source_requests=[], tool_requests=[], studio_claims=[{
            "field": "Acceptance datetime", "status": "absent", "observation": "Not found.",
            "consequence": "Cannot order intraday.", "tool_result_ids": [claim_id],
        }],
    )
    Engine(store, FakeProviders())._record_report(
        mid, "engineering", report, [], task_id="task_exact",
    )
    artifact = store.snapshot(mid)["artifacts"][-1]
    assert artifact["provenance_status"] == "invalid"
    assert artifact["studio_claims"] == []
    assert "This must be withheld" not in artifact["body"]


@pytest.mark.parametrize("claim_status,target_index", [
    ("present", 3),
    ("absent", 2),
])
def test_claims_cannot_link_empty_or_context_truncated_evidence(store, claim_status, target_index):
    mid = store.create("Reject evidence the model could not fully see", "live")["id"]
    path = "api/data/edgar.py"
    store.get(mid)["studio"] = {"commit": "b" * 40, "files": [path]}
    records = []
    for index in range(4):
        records.append({
            "id": f"tool_{index}", "task_id": "task_exact", "agent_id": "engineering",
            "tool": "read_file", "status": "completed", "summary": "read",
            "result": {
                "path": path, "start": 1, "end": 1, "total_lines": 1,
                "text": str(index) * 8_000, "sha256": f"{index + 1:064x}",
                "commit": "b" * 40, "line_truncated": False,
                "text_truncated": False, "complete_file": True,
            },
        })
    store.get(mid)["tool_results"] = records
    report = Report(
        summary="Claim", artifact_title="Claim", artifact_body="Must be withheld.",
        messages=[], sources=[], source_requests=[], tool_requests=[], studio_claims=[{
            "field": "Field", "status": claim_status, "observation": "Claimed observation.",
            "consequence": "Claimed consequence.", "tool_result_ids": [f"tool_{target_index}"],
        }],
    )
    Engine(store, FakeProviders())._record_report(
        mid, "engineering", report, [], task_id="task_exact",
    )
    artifact = store.snapshot(mid)["artifacts"][-1]
    assert artifact["provenance_status"] == "invalid"
    assert artifact["studio_claims"] == []


def test_absence_claim_accepts_complete_untruncated_multi_chunk_coverage(store):
    mid = store.create("Allow complete chunked coverage", "live")["id"]
    path = "api/data/edgar.py"
    store.get(mid)["studio"] = {"commit": "b" * 40, "files": [path]}
    store.get(mid)["tool_results"] = [
        {
            "id": "tool_first", "task_id": "task_exact", "agent_id": "engineering",
            "tool": "read_file", "status": "completed", "summary": "read",
            "result": {
                "path": path, "start": 1, "end": 120, "total_lines": 121,
                "text": "first chunk\n", "sha256": "a" * 64, "commit": "b" * 40,
                "line_truncated": True, "text_truncated": False, "complete_file": False,
            },
        },
        {
            "id": "tool_last", "task_id": "task_exact", "agent_id": "engineering",
            "tool": "read_file", "status": "completed", "summary": "read",
            "result": {
                "path": path, "start": 121, "end": 121, "total_lines": 121,
                "text": "last chunk\n", "sha256": "a" * 64, "commit": "b" * 40,
                "line_truncated": False, "text_truncated": False, "complete_file": False,
            },
        },
    ]
    report = Report(
        summary="Claim", artifact_title="Claim", artifact_body="Model prose.",
        messages=[], sources=[], source_requests=[], tool_requests=[], studio_claims=[{
            "field": "Acceptance datetime", "status": "absent", "observation": "Not present.",
            "consequence": "Intraday ordering is unsupported.",
            "tool_result_ids": ["tool_first", "tool_last"],
        }],
    )
    Engine(store, FakeProviders())._record_report(
        mid, "engineering", report, [], task_id="task_exact",
    )
    artifact = store.snapshot(mid)["artifacts"][-1]
    assert artifact["provenance_status"] == "source_linked"
    assert len(artifact["studio_claims"][0]["evidence"]) == 2


def test_plain_report_does_not_receive_bulk_source_evidence(store):
    mid = store.create("Keep unlinked prose visibly unlinked", "live")["id"]
    store.get(mid)["studio"] = {"commit": "b" * 40, "files": ["api/data/edgar.py"]}
    store.get(mid)["tool_results"] = [{
        "id": "tool_exact", "task_id": "task_exact", "agent_id": "engineering",
        "tool": "read_file", "status": "completed", "summary": "read",
        "result": {"path": "api/data/edgar.py", "start": 1, "end": 1, "total_lines": 1,
                   "text": "source", "sha256": "a" * 64, "commit": "b" * 40},
    }]
    report = Report(
        summary="Unlinked", artifact_title="Unlinked", artifact_body="Unlinked prose.",
        messages=[], sources=[], source_requests=[], tool_requests=[],
    )
    Engine(store, FakeProviders())._record_report(
        mid, "engineering", report, [], task_id="task_exact",
    )
    artifact = store.snapshot(mid)["artifacts"][-1]
    assert artifact["provenance_status"] == "none"
    assert artifact["studio_claims"] == []
    assert artifact["body"] == "Unlinked prose."


def test_final_reviewer_can_link_team_reads_but_independent_reviewer_cannot(store):
    def run(independent):
        mid = store.create("Review visibility", "live")["id"]
        store.get(mid)["studio"] = {"commit": "b" * 40, "files": ["api/data/edgar.py"]}
        store.get(mid)["tool_results"] = [{
            "id": "team_read", "task_id": "engineering_task", "agent_id": "engineering",
            "tool": "read_file", "status": "completed", "summary": "read",
            "result": {"path": "api/data/edgar.py", "start": 1, "end": 1, "total_lines": 1,
                       "text": "source", "sha256": "a" * 64, "commit": "b" * 40,
                       "line_truncated": False, "text_truncated": False, "complete_file": True},
        }]
        report = Report(
            summary="Review", artifact_title="Review", artifact_body="Claim.", messages=[], sources=[],
            source_requests=[], tool_requests=[], studio_claims=[{
                "field": "Filing date", "status": "present", "observation": "Observed.",
                "consequence": "Usable daily.", "tool_result_ids": ["team_read"],
            }],
        )
        Engine(store, FakeProviders())._record_report(
            mid, "review", report, [], task_id="review_task", independent=independent,
        )
        return store.snapshot(mid)["artifacts"][-1]["provenance_status"]

    assert run(False) == "source_linked"
    assert run(True) == "invalid"


def test_initial_reviewer_does_not_preload_specialist_conclusions(store):
    leaked = []

    class ReviewerIsolation(FakeProviders):
        def run(self, provider, system, prompt, schema):
            result = super().run(provider, system, prompt, schema)
            context = json.loads(prompt)
            agent = next(a["id"] for a in AGENT_MAP.values() if "Your role: " + a["role"] in system)
            if schema is Report and agent == "review" and not context["relevant_artifacts"]:
                payload = json.loads(result.text)
                payload["messages"] = [{
                    "recipient": "data", "kind": "finding", "text": "PRELOADED_CONCLUSION",
                }]
                result.text = json.dumps(payload)
            elif schema is Report and agent == "data":
                if any(message["text"] == "PRELOADED_CONCLUSION" for message in context["messages_addressed_to_you"]):
                    leaked.append(True)
            return result

    engine = Engine(store, ReviewerIsolation(peer_request=False))
    mid = store.create("Keep specialist inspection independent", "live", max_revisions=0)["id"]
    engine.start(mid)
    join(engine)
    assert leaked == []


def test_independent_reviewer_sources_and_tool_activity_do_not_reach_specialists(store, monkeypatch):
    mid = store.create("Keep the initial critique isolated", "live")["id"]
    data = store.get(mid)
    data["tasks"] = [
        {"id": "review_task", "agent_id": "review", "status": "completed", "independent": True},
        {"id": "data_task", "agent_id": "data", "status": "running", "independent": False},
    ]
    data["tool_results"] = [{
        "id": "review_search", "task_id": "review_task", "agent_id": "review",
        "tool": "web_search", "status": "completed", "summary": "PRIVATE_REVIEW_QUERY",
        "result": {"status": "retrieved", "sources": [{
            "title": "Reviewer lead", "url": "https://www.sec.gov/reviewer-only",
        }]},
    }]
    data["sources"] = [{
        "title": "Reviewer page", "url": "https://www.sec.gov/reviewer-only",
        "text": "PRIVATE_REVIEW_SOURCE", "status": "retrieved", "fetched_at": "fixture",
        "task_id": "review_task", "independent": True,
    }]
    store.save(data)
    monkeypatch.setattr(
        "swarm.engine.fetch_source",
        lambda *args: pytest.fail("An independent source request was dispatched"),
    )
    report = Report(
        summary="Independent critique", artifact_title="Critique", artifact_body="Review only.",
        messages=[], sources=[], source_requests=["https://www.sec.gov/new-reviewer-page"],
        tool_requests=[],
    )
    engine = Engine(store, FakeProviders())
    engine._record_report(
        mid, "review", report, [], task_id="review_task", independent=True,
        allow_peer_messages=False,
    )
    context = json.loads(engine._context(mid, "data", "Inspect independently", task_id="data_task")[0])
    serialized = json.dumps(context)
    assert context["retrieved_sources"] == []
    assert context["team_tool_evidence"] == []
    assert "PRIVATE_REVIEW_QUERY" not in serialized
    assert "PRIVATE_REVIEW_SOURCE" not in serialized
    assert any(
        "isolated first critique" in message["text"]
        for message in store.snapshot(mid)["messages"] if message["sender"] == "system"
    )


def test_detailed_tool_context_is_current_task_only_and_independent_review_is_clean(store):
    mid = store.create("Separate assignment evidence", "live")["id"]
    store.get(mid)["tool_results"] = [
        {"id": "old", "task_id": "task-old", "agent_id": "data", "tool": "read_file",
         "status": "completed", "summary": "old", "result": {"text": "old source"}},
        {"id": "new", "task_id": "task-new", "agent_id": "data", "tool": "paper_search",
         "status": "completed", "summary": "new", "result": {"status": "retrieved"}},
    ]
    store.get(mid)["drafts"] = [{
        "id": "draft_one", "path": "api/example.py", "author": "engineering",
        "diff": "+x = 1", "status": "draft",
    }]
    engine = Engine(store, FakeProviders())
    prompt, _ = engine._context(mid, "data", "Continue", task_id="task-new")
    context = json.loads(prompt)
    assert [item["id"] for item in context["your_recent_tool_results"]] == ["new"]
    assert context["draft_changes"] == []
    prompt, _ = engine._context(mid, "review", "Independent critique", independent=True, task_id="review-task")
    context = json.loads(prompt)
    assert context["your_recent_tool_results"] == []
    assert context["draft_changes"] == []


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


def test_direct_followup_does_not_spawn_unrelated_product_ops_work(store):
    mid = store.create("A mission", "live")["id"]
    store.message(mid, "user", "engineering", "Inspect the requested files.", "question")
    engine = Engine(store, FakeProviders())
    assert [assignment.agent_id for assignment in engine._pending(mid)] == ["engineering"]
    assert engine._pending_general_followup(mid) == []
    store.message(mid, "user", "coordinator", "Summarize the open decision.", "question")
    assert [assignment.agent_id for assignment in engine._pending_general_followup(mid)] == ["product-ops"]


def test_peer_request_cannot_expand_a_scoped_mission(store):
    mid = store.create("A mission", "live")["id"]
    store.get(mid)["participants"] = ["engineering", "review"]
    store.message(mid, "review", "research-frontier", "Join this task.", "request")
    store.message(mid, "review", "engineering", "Check the draft.", "request")
    assert [assignment.agent_id for assignment in Engine(store, FakeProviders())._pending(mid)] == ["engineering"]


def test_failed_source_is_recorded_and_not_requested_repeatedly(store, monkeypatch):
    mid = store.create("A mission", "live")["id"]
    engine = Engine(store, FakeProviders())
    monkeypatch.setattr("swarm.engine.fetch_source", lambda url: (_ for _ in ()).throw(ValueError("unavailable")))
    report = Report(summary="Finding", artifact_title="Artifact", artifact_body="Body", messages=[],
                    sources=[], source_requests=["https://www.sec.gov/example"], tool_requests=[])
    engine._record_report(mid, "review", report, [])
    engine._record_report(mid, "review", report, [])
    data = store.snapshot(mid)
    assert len(data["sources"]) == 1
    assert data["sources"][0]["status"] == "unavailable"
    assert len([m for m in data["messages"] if "could not be retrieved" in m["text"]]) == 1


def test_legacy_page_request_is_blocked_after_project_source_access(store, monkeypatch):
    mid = store.create("Separate private source from public retrieval", "live")["id"]
    store.get(mid)["tool_results"] = [{
        "id": "read_one", "task_id": "task_one", "agent_id": "engineering",
        "tool": "read_file", "status": "completed", "result": {},
    }]
    monkeypatch.setattr(
        "swarm.engine.fetch_source",
        lambda *args: pytest.fail("A source-bearing role reached a public host"),
    )
    report = Report(
        summary="Finding", artifact_title="Artifact", artifact_body="Body",
        messages=[], sources=[], source_requests=["https://www.sec.gov/example"],
        tool_requests=[],
    )
    Engine(store, FakeProviders())._record_report(mid, "engineering", report, [])
    data = store.snapshot(mid)
    assert data["sources"] == []
    assert "external page request was not sent" in data["messages"][-1]["text"]


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


def test_shutdown_retains_controller_lock_while_worker_survives(store):
    release = threading.Event()
    engine = Engine(store, FakeProviders())
    engine.thread = threading.Thread(target=release.wait, daemon=True)
    engine.thread.start()
    assert engine.shutdown() is False
    with pytest.raises(RuntimeError, match="Another"):
        Store(store.root)
    release.set()
    engine.thread.join(timeout=2)


def test_terminal_live_mission_cannot_be_replayed(store):
    mid = store.create("One paid attempt", "live")["id"]
    store.get(mid)["mission"]["status"] = "completed"
    with pytest.raises(ValueError, match="not replayed"):
        Engine(store, FakeProviders()).start(mid)


def test_mission_deadline_stops_further_dispatch(store, monkeypatch):
    monkeypatch.setattr("swarm.engine.MAX_MISSION_SECONDS", 0)
    providers = FakeProviders()
    mid = store.create("Bound unattended work", "live")["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    mission = store.snapshot(mid)["mission"]
    assert mission["status"] == "needs_review"
    assert mission["max_runtime_minutes"] == 0
    assert providers.calls == []
    assert engine.deadline is None


def test_failed_model_lookup_stops_before_paid_planning(store):
    providers = FakeProviders()
    def unavailable():
        raise ProviderFailure("Gemini (HTTP 404): unavailable", True)
    providers.check_gemini_model = unavailable
    mid = store.create("A mission", "live")["id"]
    engine = Engine(store, providers)
    engine.start(mid)
    join(engine)
    assert providers.calls == []
    assert store.ledger == []
    assert store.snapshot(mid)["mission"]["status"] == "blocked"


def test_local_api_guards_and_secret_redaction(tmp_path):
    providers = Providers()
    providers.keys = {"gemini": "", "openai": ""}
    app = create_app(tmp_path, providers=providers)
    with TestClient(app) as client:
        assert client.post("/api/providers", json={"gemini_api_key": "secret-fixture-key"}).status_code == 403
        client.headers["Origin"] = "http://testserver"
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


def test_environment_provider_keys_require_explicit_opt_in(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "openai-fixture")
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-fixture")
    monkeypatch.delenv("SIGIL_SWARM_ALLOW_ENV_KEYS", raising=False)
    providers = Providers()
    assert not any(item["configured"] for item in providers.public_status().values())

    monkeypatch.setenv("SIGIL_SWARM_ALLOW_ENV_KEYS", "1")
    providers = Providers()
    assert all(item["configured"] for item in providers.public_status().values())
    assert {item["source"] for item in providers.public_status().values()} == {"environment"}


def test_stale_studio_blocks_live_dispatch_before_a_provider_call(tmp_path):
    class StaleStudio:
        root = tmp_path

        def manifest(self):
            return {
                "commit": "a" * 40, "current_head": "b" * 40,
                "branch": "codex/sigil-company", "is_current": False,
                "capabilities": {"execution": False}, "files": [],
            }

    providers = FakeProviders()
    app = create_app(tmp_path, providers=providers, studio=StaleStudio())
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        state = client.get("/api/state").json()
        assert state["runtime"]["status"] == "restart_required"
        assert state["runtime"]["can_start_live"] is False
        mission = client.post("/api/missions", json={"prompt": "Do not run stale code", "mode": "live"}).json()
        response = client.post(f"/api/missions/{mission['id']}/run", json={})
        assert response.status_code == 400
        assert "safe restart" in response.json()["detail"]
        assert providers.calls == []


def test_readiness_explains_connections_budget_and_agent_state(tmp_path):
    providers = Providers()
    providers.keys = {"gemini": "", "openai": ""}
    app = create_app(tmp_path, providers=providers)
    with TestClient(app, headers={"Origin": "http://testserver"}) as client:
        state = client.get("/api/state").json()
        assert state["app"]["version"] == "0.3.2"
        assert state["runtime"]["status"] == "waiting_for_connections"
        assert state["runtime"]["can_start_live"] is False
        assert {agent["status"] for agent in state["agents"]} == {"offline"}
        health = client.get("/api/health").json()
        assert health["studio_current"] is True
        assert health["workspace"]
        client.post("/api/providers", json={"gemini_api_key": "fixture", "openai_api_key": "fixture"})
        state = client.get("/api/state").json()
        assert state["runtime"]["can_start_live"] is True
        assert {agent["status"] for agent in state["agents"]} == {"unverified"}
        assert all(provider["source"] == "session" for provider in state["providers"].values())
        mid = client.post("/api/missions", json={"prompt": "Immutable history", "mode": "live"}).json()["id"]
        app.state.store.get(mid)["mission"]["status"] = "completed"
        response = client.post(f"/api/missions/{mid}/messages", json={"text": "Replay this", "recipient": "coordinator"})
        assert response.status_code == 400
        assert "immutable" in response.json()["detail"]


def test_export_contains_draft_hashes_checks_and_call_ledger(tmp_path):
    first_app = create_app(tmp_path, providers=FakeProviders())
    with TestClient(first_app, headers={"Origin": "http://testserver"}) as client:
        mid = client.post("/api/missions", json={"prompt": "Export provenance", "mode": "live"}).json()["id"]
        data = first_app.state.store.get(mid)
        data["participants"] = ["engineering", "review"]
        data["studio"] = {
            "commit": "a" * 40, "branch": "codex/sigil-company",
            "files": ["api/data/edgar.py"],
        }
        data["drafts"] = [{"id": "draft_one", "path": "api/example.py", "author": "engineering",
                           "content": "x = 1\n", "diff": "+x = 1\n", "before_sha256": "b" * 64,
                           "commit": "a" * 40, "status": "draft"}]
        data["tool_results"] = [
            {"id": "tool_one", "task_id": "task_one", "agent_id": "engineering",
             "tool": "check_syntax", "status": "completed", "summary": "parsed",
             "result": {"checked_drafts": [{"id": "draft_one", "path": "api/example.py", "sha256": "c" * 64}]}},
            {"id": "tool_source", "task_id": "task_source", "agent_id": "data",
             "tool": "read_file", "status": "completed", "summary": "read",
             "result": {
                 "path": "api/data/edgar.py", "start": 1, "end": 1, "total_lines": 1,
                 "text": "filingDate\n", "line_truncated": False, "text_truncated": False,
                 "complete_file": True, "sha256": "d" * 64, "commit": "a" * 40,
             }},
        ]
        first_app.state.store.save(data)
        report = Report(
            summary="Filing date is present.", artifact_title="Evidence", artifact_body="Model copy.",
            messages=[], sources=[], source_requests=[], tool_requests=[], studio_claims=[{
                "field": "Filing date", "status": "present", "observation": "Observed.",
                "consequence": "Daily ordering.", "tool_result_ids": ["tool_source"],
            }],
        )
        first_app.state.engine._record_report(
            mid, "data", report, [], task_id="task_source",
        )
        call_id = first_app.state.store.reserve(mid, "engineering", "gemini", GEMINI_MODEL, 0.1, task_id="task_one")
        first_app.state.store.settle(call_id, cost=0.01, usage={"input_tokens": 1, "output_tokens": 1}, returned_model=GEMINI_MODEL)

    reopened_app = create_app(tmp_path, providers=FakeProviders())
    with TestClient(reopened_app, headers={"Origin": "http://testserver"}) as client:
        exported = client.get(f"/api/missions/{mid}/export").text
        assert "Draft SHA-256:" in exported
        assert "Checked draft: draft_one" in exported
        assert "Provider call ledger" in exported
        assert "Structured Studio claim bindings:" in exported
        assert "Studio provenance: source_linked" in exported
        assert "SHA-256 " + "d" * 64 in exported
        assert GEMINI_MODEL in exported


@pytest.mark.parametrize("url", [
    "http://www.sec.gov/a", "https://localhost/a", "https://127.0.0.1/a",
    "https://www.sec.gov.evil.invalid/a", "https://user@www.sec.gov/a", "https://www.sec.gov:8443/a",
])
def test_public_source_boundary(url):
    with pytest.raises(ValueError):
        validate_url(url, resolve=False)
