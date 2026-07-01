"""Forward value signal — forward PE and PEG ratio from analyst estimates."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class ForwardValueSignal(Signal):
    @property
    def name(self) -> str:
        return "forward_value"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.08

    @property
    def category(self) -> str:
        return "fundamental"

    @property
    def description(self) -> str:
        return "Forward PE and PEG ratio from analyst estimates — cheaper forward valuations with growth score higher"

    @property
    def tags(self) -> list[str]:
        return ["fundamental", "valuation", "forward"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        sector_fwd_pes: dict[str, list[float]] = {}
        ticker_fwd_pe: dict[str, float] = {}

        for ticker in ctx.universe:
            fwd = ctx.forward_estimates.get(ticker, {})
            md = ctx.market_data.get(ticker, {})
            f = ctx.fundamentals.get(ticker, {})
            price = md.get("close", 0)
            eps = fwd.get("estimated_eps_avg")

            if not price or price <= 0 or not eps or eps <= 0:
                continue

            fpe = price / eps
            if fpe > 0 and fpe < 200:
                ticker_fwd_pe[ticker] = fpe
                sector = f.get("sector", "Unknown")
                sector_fwd_pes.setdefault(sector, []).append(fpe)

        sector_medians: dict[str, float] = {}
        for sector, pes in sector_fwd_pes.items():
            pes.sort()
            mid = len(pes) // 2
            sector_medians[sector] = pes[mid] if len(pes) % 2 else (pes[mid - 1] + pes[mid]) / 2

        results = []
        for ticker in ctx.universe:
            fwd = ctx.forward_estimates.get(ticker, {})
            f = ctx.fundamentals.get(ticker, {})
            md = ctx.market_data.get(ticker, {})

            fpe = ticker_fwd_pe.get(ticker)
            if fpe is None:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_forward_eps"}))
                continue

            sector = f.get("sector", "Unknown")
            med = sector_medians.get(sector)
            rev_growth = f.get("revenue_cagr_3y", 0) or 0
            num_analysts = fwd.get("number_analysts_eps", 0) or 0

            sub_scores = []
            meta: dict = {"forward_pe": round(fpe, 1)}

            # Forward PE vs sector: cheaper = better
            if med and med > 0:
                ratio = med / fpe
                pe_score = min(ratio, 2.0) / 2.0
                sub_scores.append(pe_score * 0.5)
                meta["fwd_pe_vs_sector"] = round(ratio, 3)
                meta["sector_median_fwd_pe"] = round(med, 1)

            # Absolute forward PE scoring
            if fpe < 12:
                sub_scores.append(0.45)
            elif fpe < 18:
                sub_scores.append(0.35)
            elif fpe < 25:
                sub_scores.append(0.25)
            elif fpe < 40:
                sub_scores.append(0.15)
            else:
                sub_scores.append(0.05)

            # PEG ratio: forward PE / growth rate
            if rev_growth > 0.02:
                peg = fpe / (rev_growth * 100)
                meta["peg_ratio"] = round(peg, 2)
                if peg < 0.8:
                    sub_scores.append(0.45)
                elif peg < 1.2:
                    sub_scores.append(0.35)
                elif peg < 2.0:
                    sub_scores.append(0.2)
                else:
                    sub_scores.append(0.05)

            score = sum(sub_scores) / max(len(sub_scores), 1)
            score = max(min(score * 2.0, 1.0), 0.0)

            confidence = 0.35
            if num_analysts >= 10:
                confidence = 0.8
            elif num_analysts >= 5:
                confidence = 0.65
            elif num_analysts >= 2:
                confidence = 0.5

            meta["num_analysts"] = num_analysts

            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 4),
                confidence=round(confidence, 3),
                metadata=meta,
            ))
        return results
