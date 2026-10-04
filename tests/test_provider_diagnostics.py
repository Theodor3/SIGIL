import json
from types import SimpleNamespace

import pytest

from swarm.provider_diagnostics import request_profile
from swarm.providers import provider_failure
from swarm.models import Report
from swarm.response_contract import response_schema
from swarm.store import Store


def test_nested_sdk_violation_is_classified_without_provider_prose():
    exc = SimpleNamespace(code=400, status="INVALID_ARGUMENT", message="Request contains an invalid argument.",
        details={"error": {"details": [{"fieldViolations": [{
            "field": "generation_config.response_json_schema.private-field",
            "description": "Schema complexity exceeded. secret-fixture-value user prompt"}]}]}})
    failure = provider_failure("gemini", exc)
    message = str(failure)
    assert "complexity limit" in message
    assert "fields=response_schema" in message
    assert "status=INVALID_ARGUMENT" in message
    assert failure.definitely_unbilled
    for private in ("private-field", "secret-fixture", "user prompt", "generation_config"):
        assert private not in message


def test_unrecognized_status_and_body_never_escape():
    failure = provider_failure("gemini", SimpleNamespace(code=400, status="private status",
        message="private message", details={"unrecognized": "private body"}))
    assert "private" not in str(failure)
    assert "status=unreported" in str(failure)


def test_unknown_transport_error_retains_reservation():
    failure = provider_failure("gemini", RuntimeError("private exception"))
    assert not failure.definitely_unbilled
    assert "private" not in str(failure)


@pytest.mark.parametrize("code", [401, 403, 404, 422, 429])
def test_known_rejections_remain_unbilled(code):
    assert provider_failure("gemini", SimpleNamespace(code=code)).definitely_unbilled


def test_profile_fingerprints_schema_without_prompt_or_enum_content():
    schema = {"type": "array", "maxItems": 0, "items": {"enum": ["private-enum"]}}
    before = json.dumps(schema)
    profile = request_profile("private-system", "private-prompt", schema)
    assert profile["enum_values"] == 1
    assert profile["zero_arrays"] == 1
    assert "private" not in json.dumps(profile)
    assert json.dumps(schema) == before
    assert profile["schema_sha256"] == request_profile("other", "other", schema)["schema_sha256"]
    schema["maxItems"] = 3
    assert profile["schema_sha256"] != request_profile("", "", schema)["schema_sha256"]


def test_independent_and_final_review_contracts_are_distinguishable():
    context = dict(your_current_source_evidence=[], allowed_tools=["read_file"],
                   allowed_recipients=["coordinator", "review"], independent_critique=True)
    first = request_profile("", "", response_schema(Report, json.dumps(context)))
    context["independent_critique"] = False
    final = request_profile("", "", response_schema(Report, json.dumps(context)))
    assert first["schema_sha256"] != final["schema_sha256"]
    assert first["zero_arrays"] > final["zero_arrays"]


def test_profile_survives_settlement_and_reopen(tmp_path):
    store = Store(tmp_path)
    try:
        mission = store.create("Diagnostic fixture", "local")
        profile = request_profile("", "", {"type": "object"})
        call = store.reserve(mission["id"], "data", "local", "fixture", 0, request_profile=profile)
        profile["prompt_bytes"] = 12345
        store.settle(call, cost=0, error="Fixture rejection")
    finally:
        store.close()
    restored = Store(tmp_path)
    try:
        saved = next(item for item in restored.ledger if item["id"] == call)
        assert saved["request_profile"]["prompt_bytes"] == 0
        assert saved["status"] == "failed"
    finally:
        restored.close()


def test_gemini_omits_only_opaque_id_enum_and_preserves_other_constraints():
    context = dict(your_current_source_evidence=[
        dict(id="tool_bb482cd9330f4840", text="fixture", text_truncated=False),
        dict(id="tool_27ccad210c3f448b", text="fixture", text_truncated=False)],
        allowed_tools=["read_file"], allowed_recipients=["coordinator"])
    prompt = json.dumps(context)
    original = response_schema(Report, prompt)
    gemini = response_schema(Report, prompt, provider="gemini")
    ids = original['$defs']['StudioClaim']['properties']['tool_result_ids']['items'].pop('enum')
    assert len(ids) == 2
    assert gemini == original
    assert response_schema(Report, prompt, provider="openai") != gemini
    assert response_schema(Report, prompt, provider="local") != gemini
