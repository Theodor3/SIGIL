"""Growth signal — revenue CAGR 3y, FCF CAGR 3y."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class GrowthSignal(Signal):
    @property
    def name(self) -> str:
        return "growth"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.22

    @property
    def category(self) -> str:
        return "fundamental"

    @property
    def description(self) -> str:
        return "Measures revenue and free cash flow growth trajectories over 3 years"

    @property
    def tags(self) -> list[str]:
        return ["fundamental", "growth", "revenue"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            fundamentals = ctx.fundamentals.get(ticker)
            if not fundamentals:
                results.append(SignalOutput(ticker, 0.0, 0.0, {}))
                continue

            rev_cagr = min(fundamentals.get("revenue_cagr_3y", 0), 1.0)
            fcf_cagr = min(fundamentals.get("fcf_cagr_3y", 0), 1.5)

            score = (rev_cagr + fcf_cagr / 1.5) / 2.0
            confidence = 0.7 if rev_cagr > 0 or fcf_cagr > 0 else 0.3

            results.append(SignalOutput(
                ticker=ticker,
                score=max(score, 0.0),
                confidence=confidence,
                metadata={
                    "revenue_cagr_3y": rev_cagr,
                    "fcf_cagr_3y": fcf_cagr,
                },
            ))
        return results
