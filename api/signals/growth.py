"""Growth signal — revenue CAGR 3y, FCF CAGR 3y, earnings growth."""
from __future__ import annotations

import math
from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


def _sigmoid_score(cagr: float, midpoint: float = 0.10, steepness: float = 12.0) -> float:
    """Map a CAGR to 0-1 using a sigmoid centered at `midpoint`.

    At midpoint CAGR → 0.5. Negative growth → below 0.5. High growth → above 0.5.
    """
    return 1.0 / (1.0 + math.exp(-steepness * (cagr - midpoint)))


class GrowthSignal(Signal):
    @property
    def name(self) -> str:
        return "growth"

    @property
    def version(self) -> str:
        return "1.1"

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
                results.append(SignalOutput(ticker, 0.5, 0.0, {}))
                continue

            rev_cagr = fundamentals.get("revenue_cagr_3y", 0) or 0
            fcf_cagr = fundamentals.get("fcf_cagr_3y", 0) or 0

            if rev_cagr == 0 and fcf_cagr == 0:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_growth_data"}))
                continue

            rev_score = _sigmoid_score(rev_cagr, midpoint=0.10)
            fcf_score = _sigmoid_score(fcf_cagr, midpoint=0.08)

            has_rev = rev_cagr != 0
            has_fcf = fcf_cagr != 0

            if has_rev and has_fcf:
                score = 0.60 * rev_score + 0.40 * fcf_score
                confidence = 0.85
            elif has_rev:
                score = rev_score
                confidence = 0.60
            else:
                score = fcf_score
                confidence = 0.50

            results.append(SignalOutput(
                ticker=ticker,
                score=round(max(min(score, 1.0), 0.0), 4),
                confidence=confidence,
                metadata={
                    "revenue_cagr_3y": round(rev_cagr, 4),
                    "fcf_cagr_3y": round(fcf_cagr, 4),
                    "rev_score": round(rev_score, 4),
                    "fcf_score": round(fcf_score, 4),
                },
            ))
        return results
