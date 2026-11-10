import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.signals.llm_conviction import LLMConvictionSignal, MODEL, _provider_usage


def response(text='{"score": 0.8, "confidence": 0.7, "reasoning": "test"}', usage=None):
    return SimpleNamespace(content=[SimpleNamespace(text=text)], model="reported-model",
                           usage=usage)


def score(resp):
    create = AsyncMock(return_value=resp)
    result = asyncio.run(LLMConvictionSignal()._score_ticker(
        SimpleNamespace(messages=SimpleNamespace(create=create)), "TEST", "synthetic"))
    assert create.call_args.kwargs["model"] == MODEL
    return result


def test_success_preserves_score_and_provider_counters():
    out = score(response(usage=SimpleNamespace(
        input_tokens=101, output_tokens=22, cache_creation_input_tokens=30,
        cache_read_input_tokens=40)))
    assert (out.score, out.confidence) == (0.8, 0.7)
    usage = out.metadata["provider_usage"]
    assert usage["status"] == "reported"
    assert usage["input_tokens"] == 101
    assert usage["output_tokens"] == 22
    assert usage["cache_creation_input_tokens"] == 30
    assert usage["cache_read_input_tokens"] == 40
    assert usage["reported_model"] == "reported-model"
    assert usage["cost_usd"] is None
    assert usage["cost_status"] == "unknown"


@pytest.mark.parametrize("text", ["not JSON", "{}", '{"score": null}', "[]"])
def test_invalid_content_retains_billable_usage(text):
    out = score(response(text, SimpleNamespace(input_tokens=10, output_tokens=3)))
    assert (out.score, out.confidence) == (0.5, 0.0)
    assert out.metadata["reason"] == "invalid_response"
    assert out.metadata["provider_usage"]["input_tokens"] == 10


def test_missing_usage_is_unknown_not_zero():
    usage = score(response()).metadata["provider_usage"]
    assert usage["status"] == "unknown"
    assert usage["input_tokens"] is None
    assert usage["output_tokens"] is None
    assert usage["cost_usd"] is None


@pytest.mark.parametrize("value", [-1, True, 1.2, "10", None])
def test_invalid_counter_is_unknown(value):
    usage = _provider_usage(response(usage=SimpleNamespace(input_tokens=value, output_tokens=4)))
    assert usage["status"] == "unknown"
    assert usage["input_tokens"] is None
    assert usage["output_tokens"] == 4


def test_zero_is_reported_only_when_provider_reports_zero():
    usage = _provider_usage(response(usage=SimpleNamespace(input_tokens=0, output_tokens=0)))
    assert usage["status"] == "reported"
    assert usage["input_tokens"] == 0
    assert usage["cache_read_input_tokens"] is None


def test_transport_failure_preserves_exception():
    client = SimpleNamespace(messages=SimpleNamespace(create=AsyncMock(
        side_effect=RuntimeError("synthetic failure"))))
    with pytest.raises(RuntimeError):
        asyncio.run(LLMConvictionSignal()._score_ticker(client, "TEST", "synthetic"))
    assert _provider_usage()["cost_usd"] is None


def test_compute_records_unknown_usage_on_transport_error(monkeypatch):
    import sys
    import api.signals.llm_conviction as module

    client = SimpleNamespace(messages=SimpleNamespace(create=AsyncMock(
        side_effect=RuntimeError("synthetic failure"))))
    monkeypatch.setitem(sys.modules, "anthropic",
                        SimpleNamespace(AsyncAnthropic=lambda **kwargs: client))
    monkeypatch.setattr(module.settings, "anthropic_api_key", "synthetic-test-only")
    monkeypatch.setattr(module, "_build_ticker_prompt", lambda ticker, ctx: "synthetic")
    ctx = SimpleNamespace(universe=["TEST"], llm_focus=[])
    out = asyncio.run(LLMConvictionSignal().compute(ctx))[0]
    assert out.metadata["reason"] == "api_error"
    assert out.metadata["provider_usage"]["status"] == "unknown"
    assert out.metadata["provider_usage"]["cost_usd"] is None


def test_compute_keeps_usage_attached_to_correct_ticker(monkeypatch):
    import sys
    import api.signals.llm_conviction as module

    async def create(**kwargs):
        ticker = kwargs["messages"][0]["content"]
        await asyncio.sleep(0)
        return response(usage=SimpleNamespace(input_tokens={"A": 10, "B": 20}[ticker],
                                              output_tokens=3))

    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setitem(sys.modules, "anthropic",
                        SimpleNamespace(AsyncAnthropic=lambda **kwargs: client))
    monkeypatch.setattr(module.settings, "anthropic_api_key", "synthetic-test-only")
    monkeypatch.setattr(module, "_build_ticker_prompt", lambda ticker, ctx: ticker)
    ctx = SimpleNamespace(universe=["A", "B"], llm_focus=["B", "A"])
    outputs = asyncio.run(LLMConvictionSignal().compute(ctx))
    assert [(o.ticker, o.metadata["provider_usage"]["input_tokens"]) for o in outputs] == [
        ("A", 10), ("B", 20)]


@pytest.mark.parametrize("field", ["score", "confidence"])
def test_numeric_overflow_preserves_response_counters(field):
    import json
    text = json.dumps({"score": .5, "confidence": .5, field: 10**400})
    out = score(response(text, SimpleNamespace(input_tokens=10, output_tokens=3)))
    assert out.metadata["reason"] == "invalid_response"
    assert out.metadata["provider_usage"]["input_tokens"] == 10
