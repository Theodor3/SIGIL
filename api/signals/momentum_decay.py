"""Momentum decay signal — penalizes stocks breaking down from highs with fading volume."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class MomentumDecaySignal(Signal):
    @property
    def name(self) -> str:
        return "momentum_decay"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.05

    @property
    def category(self) -> str:
        return "risk"

    @property
    def description(self) -> str:
        return "Penalizes stocks losing momentum — declining from 20d highs with weakening volume on rallies"

    @property
    def tags(self) -> list[str]:
        return ["risk", "momentum", "technical"]

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
            realized_vol = md.get("realized_vol_20d", 0)

            if not close or not high_20d or high_20d == low_20d:
                results.append(SignalOutput(ticker, 0.5, 0.3, {"reason": "insufficient_data"}))
                continue

            penalties = []
            meta: dict = {}

            # Distance from 20d high (how far has it fallen?)
            drawdown = (high_20d - close) / high_20d if high_20d > 0 else 0
            meta["drawdown_from_20d_high"] = round(drawdown, 4)
            if drawdown > 0.15:
                penalties.append(0.35)
            elif drawdown > 0.10:
                penalties.append(0.25)
            elif drawdown > 0.05:
                penalties.append(0.12)

            # Negative short-term momentum
            meta["ret_5d"] = round(ret_5d, 4)
            meta["ret_20d"] = round(ret_20d, 4)
            if ret_5d < -0.05:
                penalties.append(0.25)
            elif ret_5d < -0.02:
                penalties.append(0.12)

            if ret_20d < -0.10:
                penalties.append(0.2)
            elif ret_20d < -0.05:
                penalties.append(0.1)

            # Fading volume on declines (selling pressure drying up is less bad,
            # but high volume on drops is worse)
            if ret_5d < 0 and vol_ratio > 1.5:
                penalties.append(0.15)
                meta["high_vol_selloff"] = True

            # High realized volatility
            meta["realized_vol"] = round(realized_vol, 4)
            if realized_vol > 0.6:
                penalties.append(0.15)
            elif realized_vol > 0.4:
                penalties.append(0.08)

            if not penalties:
                results.append(SignalOutput(ticker, 1.0, 0.6, {**meta, "risk": "low"}))
                continue

            total_penalty = min(sum(penalties), 0.9)
            score = 1.0 - total_penalty

            confidence = 0.45 + 0.2 * min(len(penalties) / 3, 1.0) + 0.2 * (1.0 if abs(ret_5d) > 0.01 else 0.5) + 0.15

            meta["total_penalty"] = round(total_penalty, 3)
            results.append(SignalOutput(
                ticker=ticker,
                score=max(score, 0.0),
                confidence=min(confidence, 0.9),
                metadata=meta,
            ))
        return results
