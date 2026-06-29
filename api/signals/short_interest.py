"""Short interest signal — high short interest with positive catalysts = squeeze potential."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class ShortInterestSignal(Signal):
    @property
    def name(self) -> str:
        return "short_interest"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.04

    @property
    def category(self) -> str:
        return "technical"

    @property
    def description(self) -> str:
        return "Identifies squeeze potential from high short interest combined with positive price momentum"

    @property
    def tags(self) -> list[str]:
        return ["technical", "short-squeeze", "contrarian"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            md = ctx.market_data.get(ticker, {})

            short_ratio = f.get("short_ratio")
            short_pct = f.get("short_pct_float")

            if short_ratio is None and short_pct is None:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_short_data"}))
                continue

            sr = short_ratio or 0
            sp = (short_pct or 0) * 100

            short_score = 0.0
            if sp > 20:
                short_score = 0.8
            elif sp > 10:
                short_score = 0.5
            elif sp > 5:
                short_score = 0.3
            elif sr > 5:
                short_score = 0.4
            elif sr > 3:
                short_score = 0.2

            ret_5d = md.get("return_5d", 0)
            vol_ratio = md.get("volume_ratio", 1.0)
            momentum_boost = 0.0
            if ret_5d > 0.02 and short_score > 0.3:
                momentum_boost = min(ret_5d * 3, 0.3)
            if vol_ratio > 1.5 and short_score > 0.3:
                momentum_boost += 0.1

            score = short_score * 0.7 + momentum_boost * 0.3

            has_short = short_score > 0
            has_momentum = ret_5d > 0
            confidence = 0.3 + 0.3 * (1.0 if has_short else 0) + 0.2 * (1.0 if has_momentum else 0)

            results.append(SignalOutput(
                ticker=ticker,
                score=max(min(score, 1.0), 0.0),
                confidence=min(confidence, 0.85),
                metadata={
                    "short_ratio": sr,
                    "short_pct_float": round(sp, 2),
                    "short_score": round(short_score, 3),
                    "momentum_boost": round(momentum_boost, 3),
                    "ret_5d": round(ret_5d, 4),
                },
            ))
        return results
