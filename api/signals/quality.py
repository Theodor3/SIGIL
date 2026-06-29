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
        return "1.1"

    @property
    def default_weight(self) -> float:
        return 0.27

    @property
    def category(self) -> str:
        return "fundamental"

    @property
    def description(self) -> str:
        return "Scores business quality via ROIC, FCF margins, asset efficiency, and balance sheet strength"

    @property
    def tags(self) -> list[str]:
        return ["fundamental", "profitability", "balance-sheet"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            fundamentals = ctx.fundamentals.get(ticker)
            if not fundamentals:
                results.append(SignalOutput(ticker, 0.5, 0.0, {}))
                continue

            roic = fundamentals.get("roic", 0) or 0
            fcf_margin = fundamentals.get("fcf_margin", 0) or 0
            asset_turnover = fundamentals.get("asset_turnover", 0) or 0
            debt_to_ebitda = fundamentals.get("debt_to_ebitda")
            roe = fundamentals.get("roe", 0) or 0
            operating_margin = fundamentals.get("operating_margin", 0) or 0

            # Normalize each component to 0-1
            roic_score = min(max(roic, 0), 0.5) / 0.5          # 50%+ ROIC = perfect
            fcf_score = min(max(fcf_margin, 0), 0.4) / 0.4     # 40%+ FCF margin = perfect
            at_score = min(max(asset_turnover, 0), 2.0) / 2.0  # 2.0+ = perfect
            roe_score = min(max(roe, 0), 0.4) / 0.4            # 40%+ ROE = perfect
            margin_score = min(max(operating_margin, 0), 0.4) / 0.4

            # Balance sheet: use debt_to_ebitda (lower is better)
            if debt_to_ebitda is not None and debt_to_ebitda >= 0:
                bs_score = max(1.0 - debt_to_ebitda / 4.0, 0)
            else:
                bs_score = 0.5

            # Weighted composite — profitability metrics matter most
            score = (
                0.30 * roic_score +
                0.25 * fcf_score +
                0.15 * margin_score +
                0.10 * roe_score +
                0.10 * at_score +
                0.10 * bs_score
            )

            # Confidence based on how many data points we actually have
            data_points = 0
            if roic > 0: data_points += 1
            if fcf_margin > 0: data_points += 1
            if asset_turnover > 0: data_points += 1
            if debt_to_ebitda is not None: data_points += 1
            if roe > 0: data_points += 1
            if operating_margin > 0: data_points += 1

            confidence = min(data_points / 4.0, 1.0)

            results.append(SignalOutput(
                ticker=ticker,
                score=max(min(score, 1.0), 0.0),
                confidence=confidence,
                metadata={
                    "roic": round(roic, 4),
                    "fcf_margin": round(fcf_margin, 4),
                    "asset_turnover": round(asset_turnover, 3),
                    "debt_to_ebitda": debt_to_ebitda,
                    "roe": round(roe, 4),
                    "operating_margin": round(operating_margin, 4),
                    "sector": fundamentals.get("sector", ""),
                },
            ))
        return results
