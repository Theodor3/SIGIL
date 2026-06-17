"""Proxy-inferred signal — market-proxy signals for names without direct alt data.

Uses proxy nowcast sources (market-based indicators) when direct alt data
(Wikipedia, GDELT) is unavailable. Applies a reliability discount vs direct signals.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class ProxyInferredSignal(Signal):
    @property
    def name(self) -> str:
        return "proxy_inferred"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.08

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            nowcast = (ctx.nowcast or {}).get(ticker)
            if not nowcast:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"source": "no_data"}))
                continue

            source_mix = nowcast.get("source_mix", "none")
            has_proxy = source_mix in ("proxy_only", "hybrid")
            if not has_proxy:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"source": source_mix}))
                continue

            kpi_surprise = nowcast.get("kpi_surprise", 0) or 0
            deviation = nowcast.get("deviation", 0) or 0
            prob_outperform = nowcast.get("probability_outperform")
            centered_prob = (prob_outperform - 0.5) * 2 if prob_outperform is not None else None

            components = [v for v in [kpi_surprise, deviation, centered_prob] if v is not None]
            if not components:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"source": source_mix}))
                continue

            score = max(sum(components) / len(components), 0)

            proxy_count = nowcast.get("proxy_source_count", 0)
            nowcast_conf = nowcast.get("confidence", 0)
            discount = 0.82 if source_mix == "proxy_only" else 0.92
            confidence = min(
                (0.55 * min(proxy_count / 2, 1.0) + 0.45 * nowcast_conf) * discount,
                1.0,
            )

            results.append(SignalOutput(
                ticker=ticker,
                score=min(score, 1.0),
                confidence=confidence,
                metadata={
                    "source_mix": source_mix,
                    "kpi_surprise": kpi_surprise,
                    "deviation": deviation,
                    "proxy_count": proxy_count,
                },
            ))
        return results
