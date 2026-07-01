"""Earnings miss risk — penalizes companies with high expectations and deteriorating fundamentals."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class EarningsMissRiskSignal(Signal):
    @property
    def name(self) -> str:
        return "earnings_miss_risk"

    @property
    def version(self) -> str:
        return "1.1"

    @property
    def default_weight(self) -> float:
        return 0.05

    @property
    def category(self) -> str:
        return "risk"

    @property
    def description(self) -> str:
        return "Flags companies likely to miss earnings — high valuation expectations combined with slowing growth"

    @property
    def tags(self) -> list[str]:
        return ["risk", "earnings", "expectations"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            if not f:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            forward_pe = f.get("forward_pe")
            trailing_pe = f.get("trailing_pe")
            rev_growth = f.get("revenue_cagr_3y", 0) or 0
            fcf_margin = f.get("fcf_margin", 0) or 0
            ev_to_revenue = f.get("ev_to_revenue")

            history = ctx.earnings_history.get(ticker, [])
            recent_misses = 0
            if history:
                for e in history[:4]:
                    surprise = e.get("surprise_pct", 0) or 0
                    if surprise < -2:
                        recent_misses += 1

            fwd = ctx.forward_estimates.get(ticker, {})

            penalties = []
            meta: dict = {}

            if forward_pe and trailing_pe and forward_pe > 0 and trailing_pe > 0:
                pe_expansion = trailing_pe / forward_pe
                meta["pe_expansion_expected"] = round(pe_expansion, 2)
                if pe_expansion > 1.3:
                    penalties.append(0.15)
                elif pe_expansion > 1.15:
                    penalties.append(0.08)

            if forward_pe and forward_pe > 40 and rev_growth < 0.15:
                penalties.append(0.25)
                meta["expensive_slow_growth"] = True
            elif forward_pe and forward_pe > 30 and rev_growth < 0.08:
                penalties.append(0.15)
                meta["expensive_slow_growth"] = True

            if ev_to_revenue and ev_to_revenue > 10 and fcf_margin < 0.1:
                penalties.append(0.2)
                meta["high_ev_low_fcf"] = True

            if rev_growth < 0 and forward_pe and forward_pe > 20:
                penalties.append(0.2)
                meta["declining_revenue_premium"] = True

            if recent_misses >= 2:
                penalties.append(0.2)
            elif recent_misses == 1:
                penalties.append(0.1)
            meta["recent_misses"] = recent_misses

            if fcf_margin < -0.05:
                penalties.append(0.15)
                meta["negative_fcf"] = True

            # Forward estimates: wide EPS spread = high uncertainty = miss risk
            eps_low = fwd.get("estimated_eps_low")
            eps_high = fwd.get("estimated_eps_high")
            eps_avg = fwd.get("estimated_eps_avg")
            if eps_low and eps_high and eps_avg and eps_avg > 0:
                spread = (eps_high - eps_low) / eps_avg
                meta["eps_estimate_spread"] = round(spread, 2)
                if spread > 1.0:
                    penalties.append(0.2)
                elif spread > 0.5:
                    penalties.append(0.1)

            # Forward revenue vs historical growth: analysts expect acceleration
            # that fundamentals don't support
            rev_avg = fwd.get("estimated_revenue_avg")
            market_cap = f.get("market_cap")
            if rev_avg and market_cap and market_cap > 0 and ev_to_revenue:
                implied_growth = rev_avg / (market_cap / max(ev_to_revenue, 0.1)) - 1.0
                if implied_growth > 0.3 and rev_growth < 0.1:
                    penalties.append(0.15)
                    meta["aggressive_revenue_forecast"] = True

            num_analysts = fwd.get("number_analysts_eps", 0) or 0
            meta["num_analysts_eps"] = num_analysts

            if not penalties:
                results.append(SignalOutput(ticker, 1.0, 0.5, {**meta, "risk": "low"}))
                continue

            total_penalty = min(sum(penalties), 0.9)
            score = 1.0 - total_penalty

            has_pe = forward_pe is not None
            has_history = len(history) > 0
            has_fwd = bool(fwd)
            confidence = 0.3 + 0.15 * (1.0 if has_pe else 0) + 0.15 * (1.0 if has_history else 0) + 0.15 * (1.0 if has_fwd else 0) + 0.1 * min(len(penalties) / 3, 1.0) + 0.15 * min(num_analysts / 10, 1.0)

            meta["total_penalty"] = round(total_penalty, 3)
            results.append(SignalOutput(
                ticker=ticker,
                score=max(score, 0.0),
                confidence=min(confidence, 0.9),
                metadata=meta,
            ))
        return results
