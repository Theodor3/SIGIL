"""
Signal template — copy this file to create a new signal.

Steps:
  1. Copy this file: cp template.py my_signal.py
  2. Rename the class and fill in name, version, default_weight
  3. Implement compute() — score every ticker in ctx.universe
  4. Add your signal's weight to config/alpha_model.json
  5. Restart the server — the registry picks it up automatically
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class MySignal(Signal):
    @property
    def name(self) -> str:
        return "my_signal"

    @property
    def version(self) -> str:
        return "0.1"

    @property
    def default_weight(self) -> float:
        return 0.05

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            # TODO: replace with real scoring logic
            score = 0.0
            confidence = 0.0
            results.append(SignalOutput(
                ticker=ticker,
                score=score,
                confidence=confidence,
                metadata={},
            ))
        return results
