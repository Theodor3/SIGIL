"""Value signal — relative valuation vs sector using P/E, EV/EBITDA, P/S."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class ValueSignal(Signal):
    @property
    def name(self) -> str:
        return "value"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.10

    @property
    def category(self) -> str:
        return "fundamental"

    @property
    def description(self) -> str:
        return "Relative valuation vs sector peers using P/E, EV/EBITDA, and price-to-sales"

    @property
    def tags(self) -> list[str]:
        return ["fundamental", "valuation", "relative"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        sector_medians = self._compute_sector_medians(ctx)

        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker)
            if not f:
                results.append(SignalOutput(ticker, 0.5, 0.0, {}))
                continue

            sector = f.get("sector", "Unknown")
            medians = sector_medians.get(sector, {})
            sub_scores = []
            meta = {}

            pe = f.get("trailing_pe")
            med_pe = medians.get("trailing_pe")
            if pe and med_pe and pe > 0 and med_pe > 0:
                ratio = med_pe / pe
                sub_scores.append(min(ratio, 2.0) / 2.0)
                meta["pe_ratio_vs_sector"] = round(ratio, 3)

            ev_ebitda = f.get("ev_to_ebitda")
            med_ev = medians.get("ev_to_ebitda")
            if ev_ebitda and med_ev and ev_ebitda > 0 and med_ev > 0:
                ratio = med_ev / ev_ebitda
                sub_scores.append(min(ratio, 2.0) / 2.0)
                meta["ev_ebitda_vs_sector"] = round(ratio, 3)

            ps = f.get("price_to_sales")
            med_ps = medians.get("price_to_sales")
            if ps and med_ps and ps > 0 and med_ps > 0:
                ratio = med_ps / ps
                sub_scores.append(min(ratio, 2.0) / 2.0)
                meta["ps_vs_sector"] = round(ratio, 3)

            if sub_scores:
                score = sum(sub_scores) / len(sub_scores)
                coverage = len(sub_scores) / 3.0
                confidence = 0.30 * coverage + 0.25 * (1.0 if med_pe else 0.35) + 0.20 + 0.15 * coverage + 0.10 * (0.6 if f else 0)
            else:
                score = 0.5
                confidence = 0.35

            results.append(SignalOutput(
                ticker=ticker,
                score=max(min(score, 1.0), 0.0),
                confidence=min(confidence, 1.0),
                metadata=meta,
            ))
        return results

    def _compute_sector_medians(self, ctx) -> dict[str, dict]:
        by_sector: dict[str, list[dict]] = {}
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker)
            if f:
                sector = f.get("sector", "Unknown")
                by_sector.setdefault(sector, []).append(f)

        medians = {}
        for sector, items in by_sector.items():
            medians[sector] = {}
            for key in ("trailing_pe", "ev_to_ebitda", "price_to_sales"):
                vals = sorted(v for item in items if (v := item.get(key)) and v > 0)
                if vals:
                    mid = len(vals) // 2
                    medians[sector][key] = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
        return medians
