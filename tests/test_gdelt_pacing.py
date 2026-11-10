"""Offline response replay against the frozen pre-optimization provider.

Fixtures are synthetic HTTP responses, not historical market observations.
No network, real sleeps, credentials, or orders are used.
"""
import asyncio
import copy
import importlib.util
import json
from dataclasses import asdict
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from api.data import gdelt
from api.data.context import PipelineContext
from api.model import scorer
from api.model.portfolio import construct_portfolio
from api.signals.alt_momentum import AltMomentumSignal
from api.signals.base import SignalOutput
from api.signals.llm_conviction import _build_ticker_prompt


def legacy_module():
    path = Path(__file__).parent / "fixtures/pipeline_speed/gdelt_before.py"
    spec = importlib.util.spec_from_file_location("gdelt_before", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def replay(module, monkeypatch, tickers, outcomes, fundamentals=None):
    clock = SimpleNamespace(now=0.0)
    requests = []
    sleeps = []

    async def sleep(seconds):
        assert seconds >= 0
        sleeps.append(seconds)
        clock.now += seconds

    class Client:
        def __init__(self, **kwargs):
            assert kwargs == {"timeout": 15}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, *, params):
            index = len(requests)
            requests.append({"at": clock.now, "url": url, "params": copy.deepcopy(params)})
            item = outcomes[index % len(outcomes)]
            clock.now += item.get("seconds", 0)
            if item.get("timeout"):
                raise httpx.ReadTimeout("synthetic timeout")
            if item.get("bad_json"):
                return httpx.Response(200, text="not JSON")
            return httpx.Response(item.get("status", 200), json=item.get("body", {}))

    with monkeypatch.context() as patch:
        patch.setattr(module.httpx, "AsyncClient", Client)
        patch.setattr(module.asyncio, "sleep", sleep)
        patch.setattr(module, "monotonic", lambda: clock.now, raising=False)
        result = asyncio.run(module.GdeltProvider().fetch(tickers, fundamentals=fundamentals))
    return result, requests, clock.now, sleeps


def series(sign=1):
    return {"timeline": [{"data": [
        {"value": sign * (i - 5) / 3, "norm": i + 1} for i in range(12)
    ]}]}


MIXED = [
    {"seconds": 0.1, "body": series()},
    {"seconds": 15, "timeout": True},
    {"seconds": 3, "body": series(-1)},
    {"seconds": 0.2, "status": 429},
    {"seconds": 8, "status": 500},
    {"seconds": 0.3, "bad_json": True},
    {"seconds": 0.2, "body": {"timeline": []}},
    {"seconds": 9, "body": {"timeline": [{"data": [{"value": 1}]}]}},
    {"seconds": 0.1, "body": series(0)},
    {"seconds": 12, "body": {"timeline": [{"data": None}]}},
]


@pytest.mark.parametrize("outcomes", [MIXED, [{"seconds": 15, "timeout": True}],
                                       [{"seconds": 0.1, "body": series()}]])
@pytest.mark.parametrize("tickers", [[], ["AAPL"], ["XY"],
                                     ["AAPL", "MSFT", "XY"] + [f"T{i:03}" for i in range(306)]])
def test_identical_requests_coverage_fields_and_order(monkeypatch, outcomes, tickers):
    before = replay(legacy_module(), monkeypatch, tickers, outcomes)
    after = replay(gdelt, monkeypatch, tickers, outcomes)
    assert after[0] == before[0]
    assert list(after[0]) == list(before[0])
    # Restore exact response-to-request pacing, including failure paths.
    assert after == before
    assert len(after[1]) <= 50
    for a, b in zip(after[1], after[1][1:]):
        assert b["at"] - a["at"] >= 5.5 - 1e-9


def test_rate_limit_cooldown_and_final_backoff_are_preserved(monkeypatch):
    outcomes = [{"seconds": 15, "status": 429}]
    before = replay(legacy_module(), monkeypatch, ["AAPL", "MSFT"], outcomes)
    after = replay(gdelt, monkeypatch, ["AAPL", "MSFT"], outcomes)
    assert after == before
    assert after[1][1]["at"] == 25.5
    assert after[2] == 45.5  # final response still waits the original five seconds


def test_failure_diagnostics_identify_each_outcome(monkeypatch, capsys):
    replay(gdelt, monkeypatch, [f"T{i:03}" for i in range(10)], MIXED)
    events = [json.loads(line.split(" ", 1)[1]) for line in capsys.readouterr().out.splitlines()]
    assert [e["outcome"] for e in events] == [
        "success", "timeout", "success", "http_error", "http_error",
        "invalid_json_or_value", "empty_timeline", "short_timeline", "success", "invalid_response"]
    assert events[3]["http_status"] == 429
    assert events[4]["http_status"] == 500
    assert all(set(e) == {"source", "ticker", "outcome", "http_status"} for e in events)


def test_slow_responses_restore_original_post_response_pause(monkeypatch):
    tickers = [f"T{i:03}" for i in range(50)]
    outcomes = [{"seconds": 15, "body": series()}]
    before = replay(legacy_module(), monkeypatch, tickers, outcomes)
    after = replay(gdelt, monkeypatch, tickers, outcomes)
    assert len(after[0]) == len(before[0]) == 50
    assert before[2] == 1019.5
    assert after == before
    assert after[0] == before[0]
    assert all(b["at"] - a["at"] == 20.5 for a, b in zip(after[1], after[1][1:]))


@pytest.mark.parametrize("enabled", [False, True])
def test_replayed_results_preserve_signals_scores_gates_rankings_and_targets(monkeypatch, enabled):
    tickers = ["AAPL", "MSFT"] + [f"T{i:03}" for i in range(60)]
    before = replay(legacy_module(), monkeypatch, tickers, MIXED)[0]
    after = replay(gdelt, monkeypatch, tickers, MIXED)[0]
    fundamentals = {t: {"sector": "Technology", "roic": 0.2} for t in tickers}
    contexts = [PipelineContext(as_of_date=date(2026, 11, 10), universe=tickers,
                                fundamentals=fundamentals, nowcast=data)
                for data in (before, after)]
    outputs = [asyncio.run(AltMomentumSignal().compute(ctx)) for ctx in contexts]
    assert outputs[0] == outputs[1]
    assert [_build_ticker_prompt(t, contexts[0]) for t in tickers] == [
        _build_ticker_prompt(t, contexts[1]) for t in tickers]
    if enabled:
        # Production currently disables alt_momentum. Also exercise a nonzero
        # weight so an accidental output change cannot hide behind that setting.
        monkeypatch.setattr(scorer, "load_weights", lambda: {"alt_momentum": .5, "quality": .5})
    regime = SimpleNamespace(factor_tilts={"alt_momentum": .75})
    quality = [SignalOutput(t, .8 - i / 100, .7) for i, t in enumerate(tickers)]
    scores = [scorer.score_universe({"alt_momentum": output, "quality": quality}, {}, regime)
              for output in outputs]
    assert [asdict(row) for row in scores[0]] == [asdict(row) for row in scores[1]]
    prices = {t: 100 for t in tickers}
    sectors = {t: "Technology" for t in tickers}
    assert construct_portfolio(scores[0], 10000, prices, sectors) == construct_portfolio(
        scores[1], 10000, prices, sectors)
