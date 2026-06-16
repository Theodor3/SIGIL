"""PEAD signal — post-earnings announcement drift."""
from __future__ import annotations

from statistics import mean
from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

MIN_SAMPLES = 2
MAX_DAYS_TO_EARNINGS = 45
PROXIMITY_FLOOR = 0.2


class PEADSignal(Signal):
    @property
    def name(self) -> str:
        return "pead"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.08

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            history = ctx.earnings_history.get(ticker, [])
            next_earnings = ctx.earnings_calendar.get(ticker)

            if len(history) < MIN_SAMPLES or not next_earnings:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"reason": "insufficient_data"}))
                continue

            days_to = (next_earnings - ctx.as_of_date).days
            if days_to > MAX_DAYS_TO_EARNINGS or days_to < 0:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"reason": "outside_window"}))
                continue

            returns = [e["return_5d"] for e in history]
            avg_return = mean(returns)
            hit_rate = sum(1 for r in returns if r > 0) / len(returns)
            proximity = max(PROXIMITY_FLOOR, 1.0 - (days_to - 5) / 40)

            score = max(avg_return, 0) * hit_rate * proximity

            results.append(SignalOutput(
                ticker=ticker,
                score=min(score, 0.12),
                confidence=hit_rate,
                metadata={
                    "days_to_earnings": days_to,
                    "samples": len(history),
                    "avg_return_5d": round(avg_return, 4),
                    "hit_rate": round(hit_rate, 3),
                    "proximity": round(proximity, 3),
                },
            ))
        return results
