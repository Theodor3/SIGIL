import json

import httpx2
import openai
import pytest

from swarm.engine import Engine
from swarm.models import Assignment, Report, Source, ToolRequest
from swarm.providers import Providers, ProviderFailure
from swarm.search import SEARCH_MODEL, SEARCH_RESERVATION, web_search
from swarm.store import Store
from swarm.tooling import MissionTools
from swarm.tests.test_swarm import FakeProviders


class StudioFixture:
    def read(self, path, start=1):
        return dict(path=path, start=start, end=1, total_lines=1, text="answer = 42\n", sha256="fixture", commit="abc")


def test_worker_receives_actual_tool_result_before_finishing(tmp_path):
    class ToolProvider(FakeProviders):
        def run(self, provider, system, prompt, schema):
            result = super().run(provider, system, prompt, schema)
            context = json.loads(prompt)
            report = json.loads(result.text)
            if not context["your_recent_tool_results"]:
                report["tool_requests"] = [{"tool": "read_file", "path": p} for p in ("api/first.py", "api/second.py", "api/third.py")]
            else:
                assert [r["result"]["path"] for r in context["your_recent_tool_results"]] == ["api/first.py", "api/second.py", "api/third.py"]
                report["artifact_body"] = context["your_recent_tool_results"][-1]["result"]["text"]
            result.text = json.dumps(report)
            return result
    store = Store(tmp_path)
    try:
        mid = store.create("Inspect actual code", "live")["id"]
        provider = ToolProvider(peer_request=False)
        engine = Engine(store, provider, studio=StudioFixture())
        _, report, _, _ = engine._worker(mid, Assignment(agent_id="data", task="Read api/example.py"))
        assert report.artifact_body == "answer = 42\n"
        assert len(provider.calls) == 2
        assert store.snapshot(mid)["tool_results"][0]["status"] == "completed"
        review, _ = engine._context(mid, "review", "Review actual evidence")
        assert len(json.loads(review)["team_tool_evidence"]) == 3
    finally:
        store.close()


def test_independent_reviewer_keeps_own_tool_results_and_review_gets_exact_team_evidence(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Review exact source", "live")["id"]
        store.get(mid)["tool_results"] = [{
            "id": "read_one", "task_id": "independent-task", "agent_id": "review",
            "tool": "read_file", "status": "completed", "summary": "read_file: completed. api/example.py",
            "result": {"path": "api/example.py", "start": 4, "end": 8, "total_lines": 12,
                       "text": "four\nfive\n", "sha256": "source-hash", "commit": "abc"},
        }]
        engine = Engine(store, FakeProviders(), studio=StudioFixture())
        prompt, _ = engine._context(
            mid, "review", "Independent source check", independent=True,
            task_id="independent-task",
        )
        context = json.loads(prompt)
        assert context["relevant_artifacts"] == []
        assert context["your_recent_tool_results"][0]["result"]["sha256"] == "source-hash"
        assert context["your_current_source_evidence"][0]["sha256"] == "source-hash"
        assert context["team_source_evidence"] == []

        prompt, _ = engine._context(mid, "review", "Review the team", task_id="later-task")
        context = json.loads(prompt)
        assert context["your_prior_source_evidence"][0]["start"] == 4
        assert context["team_source_evidence"][0]["text"] == "four\nfive\n"
        assert context["team_source_evidence"][0]["sha256"] == "source-hash"
    finally:
        store.close()


def test_current_source_evidence_survives_later_tool_results(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Keep assigned reads", "live")["id"]
        records = []
        for index in range(6):
            records.append({
                "id": f"read_{index}", "task_id": "same-task", "agent_id": "engineering",
                "tool": "read_file", "status": "completed", "summary": "read_file: completed",
                "result": {"path": f"api/{index}.py", "start": 1, "end": 2, "total_lines": 2,
                           "text": "one\ntwo\n", "sha256": f"hash-{index}", "commit": "abc"},
            })
        for index in range(6):
            records.append({
                "id": f"later_{index}", "task_id": "same-task", "agent_id": "engineering",
                "tool": "check_syntax", "status": "completed", "summary": "check_syntax: completed",
                "result": {"status": "passed"},
            })
        store.get(mid)["tool_results"] = records
        context = json.loads(Engine(store, FakeProviders())._context(
            mid, "engineering", "Finish", task_id="same-task",
        )[0])
        assert len(context["your_recent_tool_results"]) == 6
        assert len(context["your_current_source_evidence"]) == 6
        assert context["your_current_source_evidence"][0]["path"] == "api/0.py"
    finally:
        store.close()


def test_explicitly_assigned_studio_paths_are_read_before_the_worker_claims_inspection(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Inspect a file", "live")["id"]
        store.get(mid)["studio"] = {"files": ["api/example.py"]}
        providers = FakeProviders(peer_request=False)
        engine = Engine(store, providers, studio=StudioFixture())
        engine._worker(mid, Assignment(agent_id="engineering", task="Inspect api/example.py exactly."))
        context = next(c for agent, schema, c in providers.calls if agent == "engineering" and schema == "Report")
        assert context["your_recent_tool_results"][0]["result"]["path"] == "api/example.py"
        assert store.snapshot(mid)["tool_results"][0]["agent_id"] == "engineering"
    finally:
        store.close()


def test_local_legacy_source_request_is_rejected_without_fetch_or_source_record(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create("Inspect local source", "live")["id"]
        monkeypatch.setattr("swarm.engine.fetch_source", lambda *args: pytest.fail("Local path reached fetch_source"))
        report = Report(
            summary="Need local source", artifact_title="Source note", artifact_body="Unverified.",
            messages=[], sources=[], source_requests=["api/example.py"], tool_requests=[],
        )
        Engine(store, FakeProviders())._record_report(mid, "engineering", report, [])
        data = store.snapshot(mid)
        assert data["sources"] == []
        assert any("Use read_file" in message["text"] for message in data["messages"])
    finally:
        store.close()


def test_unretrieved_artifact_citation_is_omitted(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Ground citations", "live")["id"]
        report = Report(
            summary="Claim", artifact_title="Claim", artifact_body="Still unverified.",
            messages=[], sources=[Source(title="Invented", url="https://internal.invalid/paper")],
            source_requests=[], tool_requests=[],
        )
        Engine(store, FakeProviders())._record_report(mid, "engineering", report, [])
        data = store.snapshot(mid)
        assert data["artifacts"][-1]["sources"] == []
        assert any("Unretrieved citation" in message["text"] for message in data["messages"])
    finally:
        store.close()


def test_paper_metadata_url_is_not_treated_as_a_retrieved_page(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Separate metadata from retrieved evidence", "live")["id"]
        url = "https://doi.org/10.1000/fixture"
        store.get(mid)["tool_results"] = [{
            "id": "paper_one", "task_id": "research-task", "agent_id": "research-events",
            "tool": "paper_search", "status": "completed", "summary": "paper_search: completed",
            "result": {"status": "retrieved", "sources": [{"title": "Lead", "url": url}]},
        }]
        report = Report(
            summary="Metadata lead", artifact_title="Metadata lead", artifact_body="Unverified lead.",
            messages=[], sources=[Source(title="Lead", url=url)], source_requests=[], tool_requests=[],
        )
        Engine(store, FakeProviders())._record_report(mid, "research-events", report, [])
        assert store.snapshot(mid)["artifacts"][-1]["sources"] == []
    finally:
        store.close()


def test_search_uses_budget_and_records_utility_model(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create("Find public sources", "live")["id"]
        runner = MissionTools(store, FakeProviders(), StudioFixture())
        calls = []
        def search(providers, query):
            assert store.budget()["reserved_usd"] == SEARCH_RESERVATION
            calls.append(query)
            return dict(model=SEARCH_MODEL, response_id="fixture", usage={"input_tokens": 80,"output_tokens": 60,"search_calls": 1},
                        estimated_cost_usd=0.014, status="retrieved", text="Fixture", sources=[])
        monkeypatch.setattr("swarm.tooling.web_search", search)
        result = runner.execute(mid, "data", ToolRequest(tool="web_search", query="SEC filings"), lambda: None)
        assert result["status"] == "completed"
        assert store.ledger[0]["model"] == SEARCH_MODEL
        assert store.budget()["pilot_usd"] == 0.014
        store.reserve(mid,"data","gemini","fixture",0.60)
        blocked = runner.execute(mid, "data", ToolRequest(tool="web_search", query="Blocked query"), lambda: None)
        assert blocked["status"] == "blocked"
        assert calls == ["SEC filings"]
    finally:
        store.close()


def test_search_sdk_citations_usage_and_single_tool_call(monkeypatch):
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx2.Response(200,json={
            "id":"resp_fixture","object":"response","created_at":1788500000,"status":"completed","model":SEARCH_MODEL,
            "output":[{"type":"web_search_call","id":"ws_1","status":"completed","action":{"type":"search","query":"SEC filings","sources":[{"type":"url","url":"https://www.sec.gov/","title":"SEC"}]}},
                {"type":"message","id":"msg_fixture","role":"assistant","status":"completed","content":[{"type":"output_text","text":"SEC source.","annotations":[{"type":"url_citation","start_index":0,"end_index":3,"title":"SEC","url":"https://www.sec.gov/"}]}]}],
            "usage":{"input_tokens":90,"output_tokens":70,"total_tokens":160,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}
        })
    actual = openai.OpenAI
    def client(**kwargs):
        assert kwargs["max_retries"] == 0
        return actual(**kwargs,http_client=httpx2.Client(transport=httpx2.MockTransport(respond)))
    monkeypatch.setattr(openai,"OpenAI",client)
    providers = Providers()
    providers.configure(openai_api_key="fixture")
    result = web_search(providers,"SEC filings")
    assert requests[0]["max_tool_calls"] == 1
    assert requests[0]["tool_choice"] == "required"
    assert requests[0]["model"] == SEARCH_MODEL
    assert requests[0]["store"] is False
    assert result["annotations"][0]["url"] == "https://www.sec.gov/"
    assert result["usage"]["search_calls"] == 1
    assert result["estimated_cost_usd"] < SEARCH_RESERVATION


def test_provider_cost_breakdown_is_an_estimate(tmp_path):
    store = Store(tmp_path)
    try:
        mid=store.create("Cost test","live")["id"]
        first=store.reserve(mid,"data","gemini","fixture",0.1)
        store.settle(first,cost=0.02)
        second=store.reserve(mid,"coordinator","openai","fixture",0.2)
        store.settle(second,cost=0.15)
        budget=store.budget()
        assert budget["cost_kind"] == "estimate"
        assert budget["by_provider"]["gemini"]["today_usd"] == 0.02
        assert budget["by_provider"]["openai"]["today_usd"] == 0.15
        assert budget["today_usd"] == 0.17
    finally:
        store.close()


def test_search_rejects_private_queries_before_dispatch(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create("Public research", "live")["id"]
        studio = StudioFixture()
        studio.files = {"api/example.py": "internal_formula = revenue * custom_company_adjustment"}
        runner = MissionTools(store, FakeProviders(), studio)
        def forbidden(*args):
            pytest.fail("An invalid public query reached a search provider")
        monkeypatch.setattr("swarm.tooling.paper_search", forbidden)
        for query in (r"C:\Users\Owner\secret.txt", "internal_formula = revenue * custom_company_adjustment", "sk-proj-" + "x" * 30):
            result = runner.execute(mid, "data", ToolRequest(tool="paper_search", query=query), lambda: None)
            assert result["status"] == "blocked"
            assert query not in json.dumps(store.snapshot(mid))
    finally:
        store.close()


def test_public_search_is_blocked_after_role_reads_project_source(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create("Keep source and public search separate", "live")["id"]
        runner = MissionTools(store, FakeProviders(), StudioFixture())
        read = runner.execute(
            mid, "data", ToolRequest(tool="read_file", path="api/example.py"),
            lambda: None, task_id="task-one",
        )
        assert read["status"] == "completed"
        monkeypatch.setattr("swarm.tooling.paper_search", lambda *args: pytest.fail("Tainted query reached public search"))
        search = runner.execute(
            mid, "data", ToolRequest(tool="paper_search", query="public market research"),
            lambda: None, task_id="task-one",
        )
        assert search["status"] == "blocked"
        assert "already received private project source" in search["summary"]
        monkeypatch.setattr("swarm.tooling.fetch_source", lambda *args: pytest.fail("Tainted URL reached public host"))
        fetch = runner.execute(
            mid, "data", ToolRequest(tool="fetch_page", query="https://www.sec.gov/example"),
            lambda: None, task_id="task-one",
        )
        assert fetch["status"] == "blocked"
        assert "already received private project source" in fetch["summary"]
    finally:
        store.close()


def test_reviewer_public_search_is_blocked_after_team_source_is_exposed(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create("Review private source", "live")["id"]
        store.get(mid)["tool_results"] = [{
            "id": "read_one", "task_id": "engineering-task", "agent_id": "engineering",
            "tool": "read_file", "status": "completed", "summary": "read_file: completed",
            "result": {"path": "api/example.py", "text": "private source", "sha256": "hash", "commit": "abc"},
        }]
        monkeypatch.setattr("swarm.tooling.paper_search", lambda *args: pytest.fail("Reviewer reached public search"))
        result = MissionTools(store, FakeProviders(), StudioFixture()).execute(
            mid, "review", ToolRequest(tool="paper_search", query="public research"),
            lambda: None, task_id="review-task",
        )
        assert result["status"] == "blocked"
        assert "already received private project source" in result["summary"]
    finally:
        store.close()


def test_sequential_downstream_worker_gets_exact_upstream_reads_and_cannot_search(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create(
            "Use upstream source", "live", specialist_execution="sequential",
        )["id"]
        store.get(mid)["tool_results"] = [{
            "id": "read_one", "task_id": "engineering-task", "agent_id": "engineering",
            "tool": "read_file", "status": "completed", "summary": "read_file: completed",
            "result": {"path": "api/example.py", "start": 2, "end": 3, "total_lines": 5,
                       "text": "two\nthree\n", "sha256": "source-hash", "commit": "abc"},
        }]
        engine = Engine(store, FakeProviders(), studio=StudioFixture())
        context = json.loads(engine._context(mid, "quant", "Use engineering evidence", task_id="quant-task")[0])
        assert context["upstream_source_evidence"][0]["path"] == "api/example.py"
        assert context["upstream_source_evidence"][0]["sha256"] == "source-hash"

        monkeypatch.setattr("swarm.tooling.paper_search", lambda *args: pytest.fail("Downstream role reached public search"))
        result = MissionTools(store, FakeProviders(), StudioFixture()).execute(
            mid, "quant", ToolRequest(tool="paper_search", query="public research"),
            lambda: None, task_id="quant-task",
        )
        assert result["status"] == "blocked"
    finally:
        store.close()


def test_malformed_search_metadata_holds_budget_as_uncertain(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mid = store.create("Public research", "live")["id"]
        runner = MissionTools(store, FakeProviders(), StudioFixture())
        monkeypatch.setattr("swarm.tooling.web_search", lambda *args: {"model": None})
        with pytest.raises(ProviderFailure):
            runner.execute(mid, "data", ToolRequest(tool="web_search", query="SEC research"), lambda: None)
        assert store.ledger[0]["status"] == "uncertain"
        assert store.budget()["uncertain"] is True
    finally:
        store.close()


def test_tool_limit_refusal_reaches_the_requesting_worker(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Read source", "live")["id"]
        store.get(mid)["tool_results"] = [{"status": "completed"}] * 32
        runner = MissionTools(store, FakeProviders(), StudioFixture())
        result = runner.execute(mid, "data", ToolRequest(tool="read_file", path="api/example.py"), lambda: None)
        assert result["status"] == "blocked"
        assert store.snapshot(mid)["messages"][-1]["recipient"] == "data"
        assert "not executed" in store.snapshot(mid)["messages"][-1]["text"]
    finally:
        store.close()


def test_check_records_exact_draft_version(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create("Check a draft", "live")["id"]
        studio = StudioFixture()
        original = {"id": "draft_one", "path": "api/example.py", "content": "x = 1\n"}
        store.get(mid)["drafts"] = [original]
        def syntax(drafts):
            assert drafts[0]["id"] == "draft_one"
            store.get(mid)["drafts"].append(dict(original, id="draft_two", content="x = 2\n"))
            return {"status": "passed", "executed": False}
        studio.syntax = syntax
        result = MissionTools(store, FakeProviders(), studio).execute(mid, "data", ToolRequest(tool="check_syntax"), lambda: None)
        assert result["result"]["checked_drafts"][0]["id"] == "draft_one"
        assert len(result["result"]["checked_drafts"]) == 1
    finally:
        store.close()
