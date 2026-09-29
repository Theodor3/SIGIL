import json

import httpx
import httpx2
from google import genai
from google.genai import types
import openai
import pytest

from swarm.models import GEMINI_MODEL, OPENAI_MODEL, Plan, Report
from swarm.providers import ProviderFailure, Providers, provider_failure
from swarm.response_contract import response_schema


def test_openai_sdk_request_and_usage(monkeypatch):
    requests = []
    payload = {"message": "Plan", "assignments": [{"agent_id": "data", "task": "Check sources"}]}
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx2.Response(200, json={
            "id": "resp_fixture", "object": "response", "created_at": 1788500000,
            "status": "completed", "model": OPENAI_MODEL,
            "output": [{"type": "message", "id": "msg_fixture", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": json.dumps(payload), "annotations": []}]}],
            "usage": {"input_tokens": 101, "output_tokens": 102, "total_tokens": 203,
                      "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 25}},
        })
    actual_client = openai.OpenAI
    def client(**kwargs):
        assert kwargs["max_retries"] == 0
        assert kwargs["base_url"] == "https://api.openai.com/v1"
        return actual_client(**kwargs, http_client=httpx2.Client(transport=httpx2.MockTransport(respond)))
    monkeypatch.setattr(openai, "OpenAI", client)
    providers = Providers()
    providers.configure(openai_api_key="fixture-only")
    result = providers.run("openai", "System", "Task", Plan)
    assert Plan.model_validate_json(result.text).assignments[0].agent_id == "data"
    assert (result.input_tokens, result.output_tokens) == (101, 102)
    assert result.returned_model == OPENAI_MODEL
    assert requests[0]["store"] is False
    assert requests[0]["text"]["format"]["strict"] is True
    assert requests[0]["max_output_tokens"] == 2400


@pytest.mark.parametrize('contextual', [False, True])
def test_gemini_sdk_request_and_thinking_usage(monkeypatch, contextual):
    requests = []
    payload = {"summary": "Fixture", "artifact_title": "Fixture", "artifact_body": "Fixture",
               "messages": [], "sources": [], "source_requests": []}
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={
            "candidates": [{"content": {"role": "model", "parts": [{"text": json.dumps(payload)}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 120, "thoughtsTokenCount": 30, "totalTokenCount": 250},
            "modelVersion": GEMINI_MODEL, "responseId": "gemini-fixture",
        })
    actual_client = genai.Client
    def client(**kwargs):
        assert kwargs["http_options"].retry_options.attempts == 1
        assert kwargs["http_options"].base_url == "https://generativelanguage.googleapis.com"
        kwargs["http_options"].httpx_client = httpx.Client(transport=httpx.MockTransport(respond))
        return actual_client(**kwargs)
    monkeypatch.setattr(genai, "Client", client)
    providers = Providers()
    providers.configure(gemini_api_key="fixture-only")
    prompt = json.dumps({'your_current_source_evidence': [
        {'id': 'tool_0123456789abcdef', 'text': 'fixture', 'text_truncated': False}],
        'allowed_tools': ['read_file'], 'allowed_recipients': ['coordinator']}) if contextual else 'Task'
    result = providers.run("gemini", "System", prompt, Report)
    assert Report.model_validate_json(result.text).summary == "Fixture"
    assert (result.input_tokens, result.output_tokens) == (100, 150)
    assert result.returned_model == GEMINI_MODEL
    assert requests[0]["generationConfig"]["responseMimeType"] == "application/json"
    generation = requests[0]["generationConfig"]
    # The legacy responseSchema does not accept additionalProperties. Send the
    # original JSON Schema via the API's JSON-schema field instead.
    assert "responseSchema" not in generation
    assert generation["responseJsonSchema"] == response_schema(Report, prompt)
    # This SDK serializes the nested protobuf field in snake case and the enum in uppercase.
    assert requests[0]["generationConfig"]["thinkingConfig"] == {"thinking_level": "MINIMAL"}
    assert not requests[0].get("tools")


def test_provider_errors_do_not_echo_keys(monkeypatch):
    def fail(**kwargs):
        raise RuntimeError("secret-fixture-key should never be shown")
    monkeypatch.setattr(openai, "OpenAI", fail)
    providers = Providers()
    providers.configure(openai_api_key="secret-fixture-key")
    with pytest.raises(ProviderFailure) as result:
        providers.run("openai", "System", "Task", Plan)
    assert "secret-fixture" not in str(result.value)


def test_gemini_model_lookup_uses_metadata_only(monkeypatch):
    requests = []
    def respond(request):
        requests.append((request.method, request.url.path))
        return httpx.Response(200, json={"name": "models/" + GEMINI_MODEL,
            "supportedGenerationMethods": ["generateContent"], "outputTokenLimit": 65536})
    actual_client = genai.Client
    def client(**kwargs):
        kwargs["http_options"].httpx_client = httpx.Client(transport=httpx.MockTransport(respond))
        return actual_client(**kwargs)
    monkeypatch.setattr(genai, "Client", client)
    providers = Providers()
    providers.configure(gemini_api_key="fixture-only")
    providers.check_gemini_model()
    assert requests == [("GET", "/v1beta/models/" + GEMINI_MODEL)]
    assert not providers.public_status()["gemini"]["verified"]


@pytest.mark.parametrize("message,expected", [
    ('Invalid JSON payload. Unknown name "additional_properties" at responseSchema', 'structured-output schema'),
    ('API key not valid. Please pass a valid API key.', 'API key was rejected'),
    ('thinking_level is unsupported', 'thinking setting'),
])
def test_gemini_400_errors_are_specific_and_redacted(message, expected):
    from google.genai.errors import ClientError
    error = ClientError(400, {"error": {"message": message + " secret-fixture-key"}})
    result = provider_failure("gemini", error)
    assert "Gemini (HTTP 400)" in str(result)
    assert expected in str(result)
    assert "secret-fixture" not in str(result)
    assert result.definitely_unbilled
