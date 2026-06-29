"""Analyst revision signal — tracks changes in analyst recommendations."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class AnalystRevisionSignal(Signal):
    @property
    def name(self) -> str:
        return "analyst_revision"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.07

    @property
    def category(self) -> str:
        return "sentiment"

    @property
    def description(self) -> str:
        return "Tracks analyst recommendation changes — upgrades and estimate revisions are reliable alpha signals"

    @property
    def tags(self) -> list[str]:
        return ["sentiment", "analyst", "revision"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            estimates = ctx.analyst_estimates.get(ticker)
            if not estimates:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            buy = estimates.get("buy", 0) + estimates.get("strong_buy", 0)
            hold = estimates.get("hold", 0)
            sell = estimates.get("sell", 0) + estimates.get("strong_sell", 0)
            total = buy + hold + sell

            prev_buy = estimates.get("prev_buy", 0)
            prev_hold = estimates.get("prev_hold", 0)
            prev_sell = estimates.get("prev_sell", 0)
            prev_total = prev_buy + prev_hold + prev_sell

            if total == 0:
                results.append(SignalOutput(ticker, 0.5, 0.1, {"reason": "no_analysts"}))
                continue

            current_sentiment = buy / total
            prev_sentiment = prev_buy / prev_total if prev_total > 0 else 0.5

            revision_delta = current_sentiment - prev_sentiment
            score = max(current_sentiment * 0.6 + max(revision_delta, 0) * 2.0 * 0.4, 0)

            confidence = min(0.3 + 0.05 * total, 0.9)

            results.append(SignalOutput(
                ticker=ticker,
                score=min(score, 1.0),
                confidence=confidence,
                metadata={
                    "buy": buy,
                    "hold": hold,
                    "sell": sell,
                    "total_analysts": total,
                    "current_sentiment": round(current_sentiment, 3),
                    "prev_sentiment": round(prev_sentiment, 3),
                    "revision_delta": round(revision_delta, 3),
                },
            ))
        return results
