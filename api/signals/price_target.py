"""Price target signal — analyst consensus upside vs current price."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class PriceTargetSignal(Signal):
    @property
    def name(self) -> str:
        return "price_target"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.15

    @property
    def category(self) -> str:
        return "sentiment"

    @property
    def description(self) -> str:
        return "Analyst consensus price target upside — scores stocks by expected return implied by Wall Street targets"

    @property
    def tags(self) -> list[str]:
        return ["sentiment", "analyst", "valuation"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        pt_data = getattr(ctx, "price_targets", {}) or {}
        market_data = ctx.market_data or {}

        results = []
        for ticker in ctx.universe:
            pt = pt_data.get(ticker)
            md = market_data.get(ticker, {})
            price = md.get("close", 0)

            if not pt or not price or price <= 0:
                results.append(SignalOutput(ticker, 0.5, 0.0, {}))
                continue

            target = pt.get("targetConsensus") or pt.get("targetMedian")
            target_high = pt.get("targetHigh")
            target_low = pt.get("targetLow")
            num_analysts = pt.get("numberOfAnalysts", 0)

            if not target or target <= 0:
                results.append(SignalOutput(ticker, 0.5, 0.0, {}))
                continue

            upside = (target - price) / price

            # Sigmoid-like mapping: 0% upside = 0.5, ±30% = saturating
            score = 0.5 + upside * 1.5
            score = max(min(score, 1.0), 0.0)

            # Confidence from analyst coverage
            if num_analysts >= 15:
                confidence = 0.85
            elif num_analysts >= 8:
                confidence = 0.70
            elif num_analysts >= 3:
                confidence = 0.55
            else:
                confidence = 0.35

            # Tighten confidence if target range is wide (less consensus)
            if target_high and target_low and target > 0:
                spread = (target_high - target_low) / target
                if spread > 0.6:
                    confidence *= 0.7

            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 4),
                confidence=round(confidence, 3),
                metadata={
                    "price": round(price, 2),
                    "target_consensus": target,
                    "upside_pct": round(upside * 100, 1),
                    "target_high": target_high,
                    "target_low": target_low,
                    "num_analysts": num_analysts,
                },
            ))
        return results
