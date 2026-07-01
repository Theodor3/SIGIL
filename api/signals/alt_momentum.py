"""Alt momentum signal — Wikipedia pageviews + GDELT news tone as attention proxy."""
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
        return "1.1"

    @property
    def default_weight(self) -> float:
        return 0.13

    @property
    def category(self) -> str:
        return "alternative"

    @property
    def description(self) -> str:
        return "Alternative momentum from Wikipedia pageviews and GDELT news sentiment"

    @property
    def tags(self) -> list[str]:
        return ["alternative", "sentiment", "nowcast"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            nowcast = (ctx.nowcast or {}).get(ticker)
            if not nowcast:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"source": "no_data"}))
                continue

            sub_scores = []
            data_points = 0
            meta: dict = {"source_mix": nowcast.get("source_mix", "none")}

            # Wikipedia pageview spike → retail attention
            kpi_surprise = nowcast.get("kpi_surprise")
            if kpi_surprise is not None and kpi_surprise != 0:
                attention_score = 0.5 + kpi_surprise * 0.4
                sub_scores.append(max(min(attention_score, 1.0), 0.0))
                meta["kpi_surprise"] = round(kpi_surprise, 4)
                data_points += 1

            # GDELT news tone shift → sentiment momentum
            tone_shift = nowcast.get("news_tone_shift") or nowcast.get("tone_shift")
            if tone_shift is not None and tone_shift != 0:
                tone_score = 0.5 + tone_shift * 0.25
                sub_scores.append(max(min(tone_score, 1.0), 0.0))
                meta["tone_shift"] = round(tone_shift, 3)
                data_points += 1

            # Deviation from expected (Wikipedia)
            deviation = nowcast.get("deviation")
            if deviation is not None and deviation != 0:
                dev_score = 0.5 + deviation * 0.3
                sub_scores.append(max(min(dev_score, 1.0), 0.0))
                meta["deviation"] = round(deviation, 4)
                data_points += 1

            # Probability outperform (Wikipedia-derived)
            prob = nowcast.get("probability_outperform")
            if prob is not None:
                sub_scores.append(prob)
                meta["prob_outperform"] = round(prob, 4)
                data_points += 1

            if not sub_scores:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"source": "no_signals"}))
                continue

            score = sum(sub_scores) / len(sub_scores)
            confidence = min(0.3 + 0.15 * data_points, 0.85)

            results.append(SignalOutput(
                ticker=ticker,
                score=round(max(min(score, 1.0), 0.0), 4),
                confidence=round(confidence, 3),
                metadata=meta,
            ))
        return results
