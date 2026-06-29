"""Dividend safety signal — payout ratio, FCF coverage, and yield stability."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class DividendSafetySignal(Signal):
    @property
    def name(self) -> str:
        return "dividend_safety"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.04

    @property
    def category(self) -> str:
        return "fundamental"

    @property
    def description(self) -> str:
        return "Scores dividend safety via payout ratio, FCF coverage, and yield — favors sustainable, well-covered dividends"

    @property
    def tags(self) -> list[str]:
        return ["fundamental", "dividend", "income"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})

            div_yield = f.get("dividend_yield")
            payout_ratio = f.get("payout_ratio")
            fcf_margin = f.get("fcf_margin", 0)

            if not div_yield or div_yield <= 0:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_dividend"}))
                continue

            yield_score = 0.0
            if div_yield > 0.06:
                yield_score = 0.4
            elif div_yield > 0.03:
                yield_score = 0.7
            elif div_yield > 0.015:
                yield_score = 0.9
            elif div_yield > 0.005:
                yield_score = 1.0
            else:
                yield_score = 0.5

            payout_score = 0.5
            if payout_ratio is not None:
                if payout_ratio < 0:
                    payout_score = 0.1
                elif payout_ratio < 0.3:
                    payout_score = 1.0
                elif payout_ratio < 0.5:
                    payout_score = 0.85
                elif payout_ratio < 0.7:
                    payout_score = 0.6
                elif payout_ratio < 0.9:
                    payout_score = 0.35
                else:
                    payout_score = 0.15

            fcf_coverage = 0.5
            if fcf_margin > 0.15:
                fcf_coverage = 1.0
            elif fcf_margin > 0.08:
                fcf_coverage = 0.75
            elif fcf_margin > 0:
                fcf_coverage = 0.5
            else:
                fcf_coverage = 0.2

            score = yield_score * 0.3 + payout_score * 0.4 + fcf_coverage * 0.3

            has_payout = payout_ratio is not None
            confidence = 0.35 + 0.3 * (1.0 if has_payout else 0) + 0.2 * (1.0 if fcf_margin > 0 else 0) + 0.15

            results.append(SignalOutput(
                ticker=ticker,
                score=max(min(score, 1.0), 0.0),
                confidence=min(confidence, 0.9),
                metadata={
                    "dividend_yield": round(div_yield, 4),
                    "payout_ratio": round(payout_ratio, 3) if payout_ratio is not None else None,
                    "fcf_margin": round(fcf_margin, 4),
                    "yield_score": round(yield_score, 3),
                    "payout_score": round(payout_score, 3),
                },
            ))
        return results
