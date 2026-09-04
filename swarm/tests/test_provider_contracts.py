import json

import httpx
import httpx2
from google import genai
from google.genai import types
import openai
import pytest

from swarm.models import GEMINI_MODEL, OPENAI_MODEL, Plan, Report
from swarm.providers import ProviderFailure, Providers


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


def test_gemini_sdk_request_and_thinking_usage(monkeypatch):
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
    result = providers.run("gemini", "System", "Task", Report)
    assert Report.model_validate_json(result.text).summary == "Fixture"
    assert (result.input_tokens, result.output_tokens) == (100, 150)
    assert result.returned_model == GEMINI_MODEL
    assert requests[0]["generationConfig"]["responseMimeType"] == "application/json"
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
