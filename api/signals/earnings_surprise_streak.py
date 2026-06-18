"""Earnings surprise streak — rewards companies that consistently beat estimates."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class EarningsSurpriseStreakSignal(Signal):
    @property
    def name(self) -> str:
        return "earnings_surprise_streak"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.06

    @property
    def category(self) -> str:
        return "event"

    @property
    def description(self) -> str:
        return "Rewards consistent earnings beats — serial beaters tend to keep beating"

    @property
    def tags(self) -> list[str]:
        return ["event", "earnings", "momentum"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            history = ctx.earnings_history.get(ticker)
            if not history or len(history) < 2:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"reason": "insufficient_history"}))
                continue

            # Count consecutive beats from most recent quarter backward
            streak = 0
            for q in history:
                if q.get("surprise_pct", 0) > 0:
                    streak += 1
                else:
                    break

            total_quarters = len(history)
            beats = sum(1 for q in history if q.get("surprise_pct", 0) > 0)
            beat_rate = beats / total_quarters

            # Average surprise magnitude (only beats)
            beat_surprises = [q["surprise_pct"] for q in history if q.get("surprise_pct", 0) > 0]
            avg_beat_pct = sum(beat_surprises) / len(beat_surprises) if beat_surprises else 0

            # Scoring: streak length is the primary driver
            # 2 consecutive beats = baseline, 4+ = strong, 6+ = exceptional
            streak_score = min(streak / 6.0, 1.0)

            # Beat rate contributes (70%+ is good)
            rate_score = min(beat_rate / 0.85, 1.0)

            # Magnitude bonus: big beats matter more than penny beats
            # avg_beat_pct is in percentage points (e.g., 5.0 = 5% beat)
            magnitude_bonus = min(avg_beat_pct / 15.0, 0.3)

            score = (streak_score * 0.55 + rate_score * 0.30 + magnitude_bonus * 0.15)
            score = min(score, 1.0)

            confidence = 0.3 + min(total_quarters / 8.0, 0.5)
            if streak >= 4:
                confidence = min(confidence + 0.15, 0.9)

            meta = {
                "streak": streak,
                "beat_rate": round(beat_rate, 2),
                "avg_beat_pct": round(avg_beat_pct, 2),
                "quarters_available": total_quarters,
                "total_beats": beats,
            }

            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 4),
                confidence=confidence,
                metadata=meta,
            ))
        return results
