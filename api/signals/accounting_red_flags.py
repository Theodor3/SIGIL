"""Accounting red flags — penalizes companies with signs of earnings manipulation."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class AccountingRedFlagsSignal(Signal):
    @property
    def name(self) -> str:
        return "accounting_red_flags"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.04

    @property
    def category(self) -> str:
        return "risk"

    @property
    def description(self) -> str:
        return "Flags earnings quality issues — revenue-to-FCF divergence, negative cash conversion, and unsustainable margins"

    @property
    def tags(self) -> list[str]:
        return ["risk", "accounting", "quality"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            if not f:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            roic = f.get("roic", 0) or 0
            fcf_margin = f.get("fcf_margin", 0) or 0
            rev_growth = f.get("revenue_cagr_3y", 0) or 0
            debt = f.get("total_debt", 0) or 0
            equity = f.get("total_equity", 1) or 1
            trailing_pe = f.get("trailing_pe")
            forward_pe = f.get("forward_pe")

            penalties = []
            meta: dict = {}
            flags: list[str] = []

            # Revenue-to-FCF divergence: growing revenue but negative/declining FCF
            # suggests aggressive revenue recognition or rising costs
            if rev_growth > 0.10 and fcf_margin < 0:
                penalties.append(0.3)
                flags.append("revenue_fcf_divergence")
                meta["rev_growth"] = round(rev_growth, 3)
                meta["fcf_margin"] = round(fcf_margin, 3)
            elif rev_growth > 0.05 and fcf_margin < -0.05:
                penalties.append(0.2)
                flags.append("revenue_fcf_divergence")

            # Negative ROIC with positive PE = market trusting reported earnings
            # that aren't generating real returns on capital
            if roic < 0 and trailing_pe and trailing_pe > 0:
                penalties.append(0.2)
                flags.append("negative_roic_positive_pe")

            # Large gap between trailing and forward PE in wrong direction
            # (trailing much higher = earnings expected to grow, but if ROIC is low
            # those earnings may not be real)
            if trailing_pe and forward_pe and trailing_pe > 0 and forward_pe > 0:
                if trailing_pe > forward_pe * 1.5 and roic < 0.05:
                    penalties.append(0.15)
                    flags.append("aggressive_forward_estimates")

            # Negative equity (liabilities exceed assets)
            if equity < 0:
                penalties.append(0.25)
                flags.append("negative_equity")

            # Very high debt with weak profitability
            if debt > 0 and equity > 0:
                de_ratio = debt / equity
                if de_ratio > 2.0 and roic < 0.05:
                    penalties.append(0.15)
                    flags.append("high_leverage_low_returns")

            meta["flags"] = flags

            if not penalties:
                results.append(SignalOutput(ticker, 1.0, 0.5, {**meta, "risk": "low"}))
                continue

            total_penalty = min(sum(penalties), 0.9)
            score = 1.0 - total_penalty

            has_profitability = roic != 0 or fcf_margin != 0
            has_valuation = trailing_pe is not None
            confidence = 0.35 + 0.2 * (1.0 if has_profitability else 0) + 0.15 * (1.0 if has_valuation else 0) + 0.15 * min(len(flags) / 2, 1.0) + 0.15

            meta["total_penalty"] = round(total_penalty, 3)
            meta["flag_count"] = len(flags)
            results.append(SignalOutput(
                ticker=ticker,
                score=max(score, 0.0),
                confidence=min(confidence, 0.9),
                metadata=meta,
            ))
        return results
