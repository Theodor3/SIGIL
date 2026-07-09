"""PEAD signal — post-earnings announcement drift.

Stocks that persistently beat EPS estimates tend to keep drifting up in
the weeks after reporting (and persistent missers keep drifting down).
Scores are centered at the 0.5 neutral: above = expected positive drift,
below = expected negative drift.

v1 emitted raw surprise magnitudes capped at 0.12 — in a 0.5-neutral
scoring system every prediction landed in short territory, so the
evaluator graded its (correct) long picks as failed shorts and the
composite scorer penalized its favorite tickers hardest.
"""
from __future__ import annotations

from statistics import mean
from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

MIN_SAMPLES = 2
MAX_DAYS_TO_EARNINGS = 45
PROXIMITY_FLOOR = 0.2
# Average EPS surprise (percent) at which the drift tilt saturates
SURPRISE_SATURATION_PCT = 10.0
# Maximum distance from the 0.5 neutral a perfect setup can reach
MAX_TILT = 0.35


class PEADSignal(Signal):
    @property
    def name(self) -> str:
        return "pead"

    @property
    def version(self) -> str:
        return "2.0"

    @property
    def default_weight(self) -> float:
        return 0.08

    @property
    def category(self) -> str:
        return "event"

    @property
    def description(self) -> str:
        return "Post-earnings announcement drift — exploits tendency for price to continue moving after earnings surprises"

    @property
    def tags(self) -> list[str]:
        return ["event", "earnings", "momentum"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            history = ctx.earnings_history.get(ticker, [])
            next_earnings = ctx.earnings_calendar.get(ticker)

            if len(history) < MIN_SAMPLES:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "insufficient_data"}))
                continue

            surprises = [e.get("surprise_pct", 0) or 0 for e in history]
            avg_surprise = mean(surprises)

            # Consistency: fraction of quarters surprising in the same
            # direction as the average — a mixed record earns a weak call
            if avg_surprise >= 0:
                consistency = sum(1 for s in surprises if s > 0) / len(surprises)
            else:
                consistency = sum(1 for s in surprises if s < 0) / len(surprises)

            if next_earnings:
                days_to = (next_earnings - ctx.as_of_date).days
                if 0 <= days_to <= MAX_DAYS_TO_EARNINGS:
                    proximity = max(PROXIMITY_FLOOR, 1.0 - (days_to - 5) / 40)
                else:
                    proximity = PROXIMITY_FLOOR
                    days_to = -1
            else:
                proximity = PROXIMITY_FLOOR
                days_to = -1

            # Signed tilt around neutral: persistent beaters drift up,
            # persistent missers drift down
            tilt = max(-1.0, min(1.0, avg_surprise / SURPRISE_SATURATION_PCT))
            score = 0.5 + MAX_TILT * tilt * consistency * proximity

            confidence = consistency * min(1.0, len(history) / 4)
            if days_to < 0:
                confidence *= 0.5

            results.append(SignalOutput(
                ticker=ticker,
                score=round(min(max(score, 0.0), 1.0), 4),
                confidence=round(confidence, 3),
                metadata={
                    "days_to_earnings": days_to,
                    "samples": len(history),
                    "avg_surprise_pct": round(avg_surprise, 2),
                    "consistency": round(consistency, 3),
                    "proximity": round(proximity, 3),
                },
            ))
        return results
