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
        return "1.1"

    @property
    def default_weight(self) -> float:
        return 0.04

    @property
    def category(self) -> str:
        return "risk"

    @property
    def description(self) -> str:
        return "Flags earnings quality issues — accruals ratio, margin gaps, leverage, and valuation mismatches"

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
            ev_to_revenue = f.get("ev_to_revenue")
            operating_margins = None
            if f.get("market_cap") and f.get("total_equity"):
                operating_margins = roic * ((equity + debt) / f["market_cap"]) if f["market_cap"] > 0 else None

            penalties = []
            meta: dict = {}
            flags: list[str] = []

            # Accruals quality: gap between operating profitability and FCF
            # Even profitable companies can have poor cash conversion
            if roic > 0 and fcf_margin is not None:
                accrual_gap = roic - fcf_margin
                meta["accrual_gap"] = round(accrual_gap, 4)
                if accrual_gap > 0.15:
                    penalties.append(0.20)
                    flags.append("high_accruals")
                elif accrual_gap > 0.08:
                    penalties.append(0.10)
                    flags.append("moderate_accruals")

            # Revenue-to-FCF divergence
            meta["rev_growth"] = round(rev_growth, 3)
            meta["fcf_margin"] = round(fcf_margin, 3)
            if rev_growth > 0.05 and fcf_margin < 0:
                penalties.append(0.25)
                flags.append("revenue_fcf_divergence")
            elif rev_growth > 0 and fcf_margin < 0.02:
                penalties.append(0.10)
                flags.append("weak_cash_conversion")

            # Low or negative FCF margin is a red flag on its own
            if fcf_margin < -0.05:
                penalties.append(0.15)
                flags.append("negative_fcf")
            elif fcf_margin < 0.03 and fcf_margin >= 0:
                penalties.append(0.05)
                flags.append("thin_fcf")

            # Negative ROIC with positive PE
            if roic < 0 and trailing_pe and trailing_pe > 0:
                penalties.append(0.20)
                flags.append("negative_roic_positive_pe")
            elif roic < 0.03 and roic >= 0:
                penalties.append(0.05)
                flags.append("low_roic")

            # PE ratio sanity: very high trailing PE suggests earnings are thin
            if trailing_pe and trailing_pe > 80:
                penalties.append(0.12)
                flags.append("extreme_pe")
            elif trailing_pe and trailing_pe > 50:
                penalties.append(0.05)
                flags.append("high_pe")

            # Trailing/forward PE gap — aggressive forward estimates
            if trailing_pe and forward_pe and trailing_pe > 0 and forward_pe > 0:
                pe_gap_ratio = trailing_pe / forward_pe
                meta["pe_gap_ratio"] = round(pe_gap_ratio, 2)
                if pe_gap_ratio > 1.5:
                    penalties.append(0.12)
                    flags.append("aggressive_forward_estimates")
                elif pe_gap_ratio > 1.25:
                    penalties.append(0.05)
                    flags.append("optimistic_forward_estimates")

            # Negative equity
            if equity < 0:
                penalties.append(0.25)
                flags.append("negative_equity")

            # Leverage concerns (graduated)
            if debt > 0 and equity > 0:
                de_ratio = debt / equity
                meta["de_ratio"] = round(de_ratio, 2)
                if de_ratio > 3.0:
                    penalties.append(0.15)
                    flags.append("extreme_leverage")
                elif de_ratio > 1.5 and roic < 0.08:
                    penalties.append(0.10)
                    flags.append("high_leverage_low_returns")
                elif de_ratio > 1.0:
                    penalties.append(0.03)
                    flags.append("moderate_leverage")

            # Expensive on EV/Revenue with weak margins
            if ev_to_revenue and ev_to_revenue > 15 and fcf_margin < 0.15:
                penalties.append(0.10)
                flags.append("expensive_low_margin")
            elif ev_to_revenue and ev_to_revenue > 8 and fcf_margin < 0.05:
                penalties.append(0.08)
                flags.append("expensive_low_margin")

            meta["flags"] = flags
            meta["roic"] = round(roic, 4)

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
