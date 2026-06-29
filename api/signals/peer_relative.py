"""Peer relative signal — deviation from consensus vs peer group.

Consumes nowcast data when available. Requires 'direct' or 'hybrid' source mix
to have meaningful peer comparison data.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class PeerRelativeSignal(Signal):
    @property
    def name(self) -> str:
        return "peer_relative"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.12

    @property
    def category(self) -> str:
        return "alternative"

    @property
    def description(self) -> str:
        return "Peer-relative deviation from consensus using direct alt data sources"

    @property
    def tags(self) -> list[str]:
        return ["alternative", "relative", "nowcast"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            nowcast = (ctx.nowcast or {}).get(ticker)
            if not nowcast:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"source": "no_data"}))
                continue

            source_mix = nowcast.get("source_mix", "none")
            has_direct = source_mix in ("direct", "hybrid")
            if not has_direct:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"source": source_mix}))
                continue

            deviation = nowcast.get("deviation", 0) or 0
            prob_outperform = nowcast.get("probability_outperform")
            centered_prob = (prob_outperform - 0.5) * 2 if prob_outperform is not None else None

            components = [v for v in [deviation, centered_prob] if v is not None]
            if not components:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"source": source_mix}))
                continue

            score = max(sum(components) / len(components), 0)

            direct_count = nowcast.get("direct_source_count", 0)
            nowcast_conf = nowcast.get("confidence", 0)
            has_deviation = deviation != 0
            confidence = min(
                0.45 * min(direct_count / 3, 1.0)
                + 0.35 * nowcast_conf
                + 0.20 * (1.0 if has_deviation else 0.5),
                1.0,
            )

            results.append(SignalOutput(
                ticker=ticker,
                score=min(score, 1.0),
                confidence=confidence,
                metadata={
                    "source_mix": source_mix,
                    "deviation": deviation,
                    "prob_outperform": prob_outperform,
                },
            ))
        return results
