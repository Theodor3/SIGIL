"""Display ranking must use the same configured group weights as Overview."""
import asyncio
from types import SimpleNamespace as S
from datetime import datetime

from api.routes.research import top_ideas_detailed


def test_research_uses_configured_weights_instead_of_signal_defaults(monkeypatch):
    import api.signals.registry as registry
    import api.model.scorer as scorer
    monkeypatch.setattr(registry, "get_registry", lambda: {
        "first": S(default_weight=.9), "second": S(default_weight=.1)})
    monkeypatch.setattr(scorer, "load_weights", lambda: {"first": .1, "second": .9})
    predictions = [S(ticker=t, signal_name=s, score=v, confidence=.8, metadata_={})
                   for t, s, v in [("AAA", "first", 1), ("AAA", "second", 0),
                                   ("BBB", "first", 0), ("BBB", "second", 1)]]

    class Result:
        def scalar_one_or_none(self):
            return S(id="fixture", started_at=datetime(2026, 1, 1), regime_id="risk_on")

        def scalars(self):
            return S(all=lambda: predictions)

    class DB:
        async def execute(self, _):
            return Result()

    result = asyncio.run(top_ideas_detailed(DB()))
    assert [r["ticker"] for r in result["ideas"]] == ["BBB", "AAA"]
    assert [r["final_score"] for r in result["ideas"]] == [.9, .1]
    assert result["ideas"][0]["top_drivers"][0] == {"signal": "second", "contribution": .9}


def test_ticker_current_and_history_use_same_configured_weights(monkeypatch):
    import api.model.scorer as scorer
    from api import cache
    from api.routes.research import ticker_drilldown
    monkeypatch.setattr(scorer, "load_weights", lambda: {"first": .1, "second": .9})
    monkeypatch.setattr(cache, "get", lambda _: {})  # never call Yahoo
    predictions = [S(signal_name="second", score=1, confidence=.8, metadata_={},
                     run_id="fixture", run_date=datetime(2026, 1, 1).date())]

    class Result:
        def __init__(self, items=()): self.items = items
        def scalar_one_or_none(self):
            return S(id="fixture", started_at=datetime(2026, 1, 1))
        def scalars(self): return self
        def all(self): return self.items

    class DB:
        def __init__(self): self.calls = 0
        async def execute(self, _):
            self.calls += 1
            return Result(predictions if self.calls in (2, 3) else [])

    result = asyncio.run(ticker_drilldown("AAA", DB()))
    assert result["final_score"] == .9
    assert result["signals"][0]["weight"] == .9
    assert result["signals"][0]["contribution"] == .9
    assert result["score_history"][0]["score"] == .9
