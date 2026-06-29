"""Technical breakout signal — price vs moving averages with volume confirmation."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class TechnicalBreakoutSignal(Signal):
    @property
    def name(self) -> str:
        return "technical_breakout"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.05

    @property
    def category(self) -> str:
        return "technical"

    @property
    def description(self) -> str:
        return "Price momentum vs 20-day range with volume confirmation — flags breakouts and breakdowns"

    @property
    def tags(self) -> list[str]:
        return ["technical", "momentum", "volume"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            md = ctx.market_data.get(ticker)
            if not md:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_market_data"}))
                continue

            close = md.get("close", 0)
            high_20d = md.get("high_20d", 0)
            low_20d = md.get("low_20d", 0)
            ret_5d = md.get("return_5d", 0)
            ret_20d = md.get("return_20d", 0)
            vol_ratio = md.get("volume_ratio", 1.0)

            if not close or not high_20d or not low_20d or high_20d == low_20d:
                results.append(SignalOutput(ticker, 0.5, 0.1, {"reason": "insufficient_data"}))
                continue

            range_position = (close - low_20d) / (high_20d - low_20d)

            momentum = 0.0
            if ret_5d > 0.02 and ret_20d > 0:
                momentum = min(ret_5d * 5, 0.5)
            elif ret_5d > 0:
                momentum = ret_5d * 2

            volume_confirm = min(max(vol_ratio - 1.0, 0) * 0.5, 0.25) if vol_ratio > 1.2 else 0

            score = range_position * 0.5 + momentum * 0.3 + volume_confirm * 0.2

            has_volume = vol_ratio > 0.5
            has_range = (high_20d - low_20d) / close > 0.02
            confidence = 0.4 + 0.25 * (1.0 if has_volume else 0) + 0.2 * (1.0 if has_range else 0) + 0.15 * min(abs(ret_5d) * 10, 1.0)

            results.append(SignalOutput(
                ticker=ticker,
                score=max(min(score, 1.0), 0.0),
                confidence=min(confidence, 0.9),
                metadata={
                    "range_position": round(range_position, 3),
                    "ret_5d": round(ret_5d, 4),
                    "ret_20d": round(ret_20d, 4),
                    "volume_ratio": round(vol_ratio, 2),
                    "momentum": round(momentum, 4),
                },
            ))
        return results
