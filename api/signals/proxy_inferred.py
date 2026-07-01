"""Proxy-inferred signal — composite quality+momentum for tickers with thin analyst coverage."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class ProxyInferredSignal(Signal):
    @property
    def name(self) -> str:
        return "proxy_inferred"

    @property
    def version(self) -> str:
        return "1.1"

    @property
    def default_weight(self) -> float:
        return 0.08

    @property
    def category(self) -> str:
        return "alternative"

    @property
    def description(self) -> str:
        return "Composite quality+momentum proxy for tickers with thin analyst coverage"

    @property
    def tags(self) -> list[str]:
        return ["alternative", "proxy", "composite"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            md = ctx.market_data.get(ticker, {})
            fwd = ctx.forward_estimates.get(ticker, {})
            pt = ctx.price_targets.get(ticker, {})

            num_analysts = (fwd.get("number_analysts_eps", 0) or 0) + (pt.get("numberOfAnalysts", 0) or 0)
            if num_analysts >= 10:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "well_covered"}))
                continue

            sub_scores = []
            data_points = 0
            meta: dict = {"num_analysts": num_analysts}

            # Fundamental quality proxy
            roic = f.get("roic", 0) or 0
            fcf = f.get("fcf_margin", 0) or 0
            if roic != 0:
                q = 0.5 + min(roic, 0.3) * 1.5
                sub_scores.append(max(min(q, 1.0), 0.0))
                data_points += 1
            if fcf != 0:
                q = 0.5 + min(fcf, 0.25) * 1.5
                sub_scores.append(max(min(q, 1.0), 0.0))
                data_points += 1

            # Momentum proxy
            ret_20d = md.get("return_20d", 0)
            if ret_20d != 0:
                m = 0.5 + ret_20d * 3
                sub_scores.append(max(min(m, 1.0), 0.0))
                data_points += 1

            # Volume surge as attention proxy
            vol_ratio = md.get("volume_ratio", 1.0)
            if vol_ratio > 1.3:
                ret_5d = md.get("return_5d", 0)
                if ret_5d > 0:
                    sub_scores.append(min(0.5 + vol_ratio * 0.15, 0.85))
                else:
                    sub_scores.append(max(0.5 - vol_ratio * 0.1, 0.2))
                data_points += 1

            # Revenue growth as earnings proxy
            rev_growth = f.get("revenue_cagr_3y", 0) or 0
            if rev_growth != 0:
                g = 0.5 + rev_growth * 2
                sub_scores.append(max(min(g, 1.0), 0.0))
                data_points += 1

            if not sub_scores:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            score = sum(sub_scores) / len(sub_scores)
            confidence = min(0.25 + 0.1 * data_points, 0.7)

            results.append(SignalOutput(
                ticker=ticker,
                score=round(max(min(score, 1.0), 0.0), 4),
                confidence=round(confidence, 3),
                metadata=meta,
            ))
        return results
