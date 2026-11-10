"""Offline coverage and scoring equivalence checks with synthetic prices."""
import asyncio
import copy
import json
from datetime import date
from types import SimpleNamespace

import httpx
import pytest

from api.data import diagnostics, tiingo
from api.data.context import PipelineContext
from api.pipeline import runner
from api.model import scorer
from api.model.portfolio import construct_portfolio
from api.signals.technical_breakout import TechnicalBreakoutSignal
from api.signals.momentum_decay import MomentumDecaySignal
from api.signals.llm_conviction import _build_ticker_prompt


@pytest.mark.parametrize("case", ["complete", "gaps", "failed", "empty"])
def test_yahoo_first_coverage_preserves_inputs_signals_scores_and_targets(monkeypatch, case):
    bucket = ["AAA", "BBB", "CCC", "DDD"] if case != "empty" else []
    row = {"close": 110, "high_20d": 112, "low_20d": 90,
           "return_5d": .04, "return_20d": .1, "volume_ratio": 1.5,
           "volume": 2000000, "closes": list(range(80, 111))}
    yahoo = {t: dict(row, close=105+i) for i, t in enumerate(bucket)}
    if case == "gaps":
        yahoo = {"AAA": yahoo["AAA"], "BBB": {"close": 0}, "CCC": {"close": None}}
    if case == "failed":
        yahoo = {}
    # Conflicting Tiingo values must never replace valid Yahoo rows.
    all_tiingo = {t: dict(row, close=95+i, _source="tiingo") for i, t in enumerate(bucket)}
    calls = []
    async def fetch(tickers):
        calls.append(tickers)
        return {t: all_tiingo[t] for t in tickers}
    monkeypatch.setattr(runner, "_fetch_tiingo_prices", fetch)
    async def check():
        async def yahoo_fetch():
            await asyncio.sleep(0)
            if case == "failed":
                raise httpx.ReadTimeout("synthetic")
            return copy.deepcopy(yahoo)
        task = asyncio.create_task(yahoo_fetch())
        results = await asyncio.gather(task, runner._fetch_tiingo_gaps(bucket, task),
                                       return_exceptions=True)
        return results[1]
    subset = asyncio.run(check())
    expected = [t for t in bucket if t not in yahoo or not yahoo[t].get("close")]
    assert calls == ([expected] if expected else [])
    contexts = []
    for fallback in (all_tiingo, subset):
        merged = copy.deepcopy(yahoo)
        for ticker, price in fallback.items():
            if ticker not in merged or not merged[ticker].get("close"):
                merged[ticker] = price
        contexts.append(PipelineContext(date(2026, 11, 10), universe=bucket, market_data=merged))
    assert contexts[0] == contexts[1]
    assert [_build_ticker_prompt(t, contexts[0]) for t in bucket] == [
        _build_ticker_prompt(t, contexts[1]) for t in bucket]
    outputs = [{s.name: asyncio.run(s.compute(ctx))
                for s in (TechnicalBreakoutSignal(), MomentumDecaySignal())} for ctx in contexts]
    assert outputs[0] == outputs[1]
    monkeypatch.setattr(scorer, "load_weights", lambda: {"technical_breakout": .6, "momentum_decay": .4})
    scores = [scorer.score_universe(o, {}, SimpleNamespace(factor_tilts={})) for o in outputs]
    assert scores[0] == scores[1]
    prices = {t: r["close"] for t, r in contexts[0].market_data.items()}
    assert construct_portfolio(scores[0], 10000, prices, {}) == construct_portfolio(scores[1], 10000, prices, {})


def test_cancellation_does_not_start_tiingo(monkeypatch):
    async def forbidden(*args):
        pytest.fail("Cancellation must not launch fallback requests")
    monkeypatch.setattr(runner, "_fetch_tiingo_prices", forbidden)
    async def check():
        future = asyncio.get_running_loop().create_future()
        future.cancel()
        with pytest.raises(asyncio.CancelledError):
            await runner._fetch_tiingo_gaps(["AAA"], future)
    asyncio.run(check())


@pytest.mark.parametrize("malformed", [False, True])
def test_tiingo_diagnostics_preserve_results_and_error_semantics(monkeypatch, capsys, malformed):
    monkeypatch.setattr(tiingo.settings, "tiingo_api_key", "secret-test-key")
    outcomes = [httpx.Response(200, json=[{"adjClose": 101, "volume": 25}]),
                httpx.Response(429), httpx.ReadTimeout("secret-test-key"),
                httpx.RemoteProtocolError("secret-test-key"), httpx.Response(200, json=[])]
    if malformed:
        outcomes.append(httpx.Response(200, text="secret-test-key"))
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, url, **kwargs):
            item = outcomes[int(url.split("/")[-2][1:])]
            if isinstance(item, Exception): raise item
            return item
    monkeypatch.setattr(tiingo.httpx, "AsyncClient", Client)
    operation = tiingo.TiingoProvider().fetch_prices([f"T{i}" for i in range(len(outcomes))])
    if malformed:
        with pytest.raises(ValueError): asyncio.run(operation)
    else:
        result = asyncio.run(operation)
        assert result == {"T0": {"close": 101, "open": None, "high": None, "low": None,
                                 "volume": 25, "closes": [101], "_source": "tiingo"}}
    logs = capsys.readouterr().out
    assert "secret-test-key" not in logs and "https://" not in logs
    events = [json.loads(line.split(" ", 1)[1]) for line in logs.splitlines()]
    assert [e["outcome"] for e in events] == ["success", "http_error", "timeout", "transport_error", "empty_prices"] + (["invalid_response"] if malformed else [])
    assert events[1]["http_status"] == 429


def test_diagnostics_cannot_break_fetch(monkeypatch):
    def broken(*args, **kwargs): raise OSError("closed log sink")
    monkeypatch.setattr("builtins.print", broken)
    diagnostics.provider_outcome("gdelt", "AAA", "timeout")
