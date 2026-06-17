"""Alt momentum signal — Wikipedia pageviews + news sentiment vs consensus.

In V2 Phase 3 this uses placeholder logic since the full nowcast pipeline
(Wikipedia + GDELT) isn't ported yet. When nowcast data is available in
PipelineContext, this signal will consume it directly.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class AltMomentumSignal(Signal):
    @property
    def name(self) -> str:
        return "alt_momentum"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.13

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            nowcast = (ctx.nowcast or {}).get(ticker)
            if not nowcast:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"source": "no_data"}))
                continue

            source_mix = nowcast.get("source_mix", "none")
            has_direct = source_mix in ("direct", "hybrid")
            if not has_direct:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"source": source_mix}))
                continue

            kpi_surprise = nowcast.get("kpi_surprise", 0) or 0
            prob_outperform = nowcast.get("probability_outperform")
            centered_prob = (prob_outperform - 0.5) * 2 if prob_outperform is not None else None

            components = [v for v in [kpi_surprise, centered_prob] if v is not None]
            if not components:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"source": source_mix}))
                continue

            score = max(sum(components) / len(components), 0)

            direct_count = nowcast.get("direct_source_count", 0)
            nowcast_conf = nowcast.get("confidence", 0)
            confidence = min(0.55 * min(direct_count / 3, 1.0) + 0.45 * nowcast_conf, 1.0)

            results.append(SignalOutput(
                ticker=ticker,
                score=min(score, 1.0),
                confidence=confidence,
                metadata={
                    "source_mix": source_mix,
                    "kpi_surprise": kpi_surprise,
                    "prob_outperform": prob_outperform,
                },
            ))
        return results
