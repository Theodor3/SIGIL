"""Buyback yield — scores companies returning capital via share repurchases."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class BuybackYieldSignal(Signal):
    @property
    def name(self) -> str:
        return "buyback_yield"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.06

    @property
    def category(self) -> str:
        return "fundamental"

    @property
    def description(self) -> str:
        return "Scores companies buying back shares — management confidence signal and EPS tailwind"

    @property
    def tags(self) -> list[str]:
        return ["fundamental", "capital_return", "buyback"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            if not f:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"reason": "no_data"}))
                continue

            market_cap = f.get("market_cap")
            buyback_ttm = f.get("buyback_ttm", 0) or 0
            fcf_margin = f.get("fcf_margin", 0) or 0
            roic = f.get("roic", 0) or 0

            if not market_cap or market_cap <= 0:
                results.append(SignalOutput(ticker, 0.0, 0.2, {"reason": "no_market_cap"}))
                continue

            # buyback_ttm is negative in cashflow (cash outflow), so negate it
            buyback_amount = abs(buyback_ttm) if buyback_ttm < 0 else 0.0
            byield = buyback_amount / market_cap

            meta = {"buyback_yield": round(byield, 4), "buyback_amount": round(buyback_amount)}

            if byield <= 0:
                results.append(SignalOutput(ticker, 0.0, 0.4, {**meta, "tier": "none"}))
                continue

            # Graduated scoring: buyback yield as fraction of a generous cap
            # 1% yield = solid, 3%+ = aggressive, cap at ~5%
            raw_score = min(byield / 0.04, 1.0)

            # Quality bonus: buybacks funded by real FCF are more meaningful
            quality_mult = 1.0
            if fcf_margin > 0.15 and roic > 0.12:
                quality_mult = 1.15
            elif fcf_margin < 0.02 or roic < 0.03:
                quality_mult = 0.6  # debt-funded buybacks are suspect

            score = min(raw_score * quality_mult, 1.0)

            confidence = 0.5
            if byield > 0.01:
                confidence = 0.7
            if byield > 0.02 and fcf_margin > 0.10:
                confidence = 0.85

            tier = "aggressive" if byield > 0.03 else "solid" if byield > 0.01 else "modest"
            meta["tier"] = tier
            meta["quality_mult"] = round(quality_mult, 2)

            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 4),
                confidence=confidence,
                metadata=meta,
            ))
        return results
