"""Debt distress signal — penalizes overleveraged companies with deteriorating coverage."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class DebtDistressSignal(Signal):
    @property
    def name(self) -> str:
        return "debt_distress"

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
        return "Penalizes overleveraged companies — high debt-to-EBITDA, low equity cushion, and poor interest coverage"

    @property
    def tags(self) -> list[str]:
        return ["risk", "leverage", "balance-sheet"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            if not f:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            debt = f.get("total_debt", 0) or 0
            equity = f.get("total_equity", 1) or 1
            debt_to_ebitda = f.get("debt_to_ebitda")
            fcf_margin = f.get("fcf_margin", 0) or 0

            penalties = []
            meta: dict = {}

            # Debt-to-equity ratio
            if equity > 0:
                de_ratio = debt / equity
                meta["debt_to_equity"] = round(de_ratio, 2)
                if de_ratio > 3.0:
                    penalties.append(0.4)
                elif de_ratio > 2.0:
                    penalties.append(0.25)
                elif de_ratio > 1.5:
                    penalties.append(0.15)
                elif de_ratio > 1.0:
                    penalties.append(0.05)
            elif debt > 0:
                penalties.append(0.5)
                meta["debt_to_equity"] = None

            # Debt-to-EBITDA
            if debt_to_ebitda is not None:
                meta["debt_to_ebitda"] = round(debt_to_ebitda, 2)
                if debt_to_ebitda > 6:
                    penalties.append(0.4)
                elif debt_to_ebitda > 4:
                    penalties.append(0.25)
                elif debt_to_ebitda > 3:
                    penalties.append(0.1)

            # Negative FCF with high debt is a red flag
            if fcf_margin < 0 and debt > 0:
                penalties.append(0.2)
                meta["negative_fcf_with_debt"] = True

            if not penalties:
                results.append(SignalOutput(ticker, 1.0, 0.6, {**meta, "risk": "low"}))
                continue

            total_penalty = min(sum(penalties), 0.9)
            score = 1.0 - total_penalty

            has_debt_data = debt > 0 or equity > 0
            has_ebitda = debt_to_ebitda is not None
            confidence = 0.4 + 0.25 * (1.0 if has_debt_data else 0) + 0.2 * (1.0 if has_ebitda else 0) + 0.15 * min(len(penalties) / 2, 1.0)

            meta["total_penalty"] = round(total_penalty, 3)
            results.append(SignalOutput(
                ticker=ticker,
                score=max(score, 0.0),
                confidence=min(confidence, 0.9),
                metadata=meta,
            ))
        return results
