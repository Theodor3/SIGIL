"""Quality signal — ROIC, FCF margin, asset turnover, balance sheet strength."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class QualitySignal(Signal):
    @property
    def name(self) -> str:
        return "quality"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.27

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            fundamentals = ctx.fundamentals.get(ticker)
            if not fundamentals:
                results.append(SignalOutput(ticker, 0.0, 0.0, {}))
                continue

            roic = min(fundamentals.get("roic", 0), 1.0)
            fcf_margin = min(fundamentals.get("fcf_margin", 0), 0.75)
            asset_turnover = min(fundamentals.get("asset_turnover", 0), 1.5) / 1.5
            debt = fundamentals.get("total_debt", 0)
            equity = fundamentals.get("total_equity", 1)
            balance_sheet = 1.0 / (1.0 + max(debt / max(equity, 1), 0))

            score = (roic + fcf_margin + asset_turnover + balance_sheet) / 4.0

            has_profitability = roic > 0 or fcf_margin > 0
            has_debt_data = debt > 0 or equity > 0
            coverage = 0.45 * (1.0 if fundamentals else 0.0)
            coverage += 0.20 * (1.0 if has_profitability else 0.0)
            coverage += 0.10 * (1.0 if has_debt_data else 0.0)
            confidence = min(coverage + 0.25, 1.0)

            results.append(SignalOutput(
                ticker=ticker,
                score=max(score, 0.0),
                confidence=confidence,
                metadata={
                    "roic": roic,
                    "fcf_margin": fcf_margin,
                    "asset_turnover": asset_turnover * 1.5,
                    "balance_sheet": balance_sheet,
                    "sector": fundamentals.get("sector", ""),
                    "industry": fundamentals.get("industry", ""),
                },
            ))
        return results
