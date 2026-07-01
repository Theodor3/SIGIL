"""Peer relative signal — compares momentum, valuation, and quality vs sector peers."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class PeerRelativeSignal(Signal):
    @property
    def name(self) -> str:
        return "peer_relative"

    @property
    def version(self) -> str:
        return "1.1"

    @property
    def default_weight(self) -> float:
        return 0.12

    @property
    def category(self) -> str:
        return "alternative"

    @property
    def description(self) -> str:
        return "Ranks stocks vs sector peers on momentum, quality, and attention"

    @property
    def tags(self) -> list[str]:
        return ["alternative", "relative", "sector"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        by_sector: dict[str, list[str]] = {}
        for ticker in ctx.universe:
            sector = ctx.fundamentals.get(ticker, {}).get("sector", "Unknown")
            by_sector.setdefault(sector, []).append(ticker)

        def _percentile(val: float, vals: list[float]) -> float:
            if not vals or len(vals) < 3:
                return 0.5
            below = sum(1 for v in vals if v < val)
            return below / len(vals)

        sector_returns: dict[str, list[float]] = {}
        sector_roic: dict[str, list[float]] = {}
        sector_fcf: dict[str, list[float]] = {}

        for sector, tickers in by_sector.items():
            rets = []
            roics = []
            fcfs = []
            for t in tickers:
                md = ctx.market_data.get(t, {})
                f = ctx.fundamentals.get(t, {})
                r20 = md.get("return_20d")
                if r20 is not None:
                    rets.append(r20)
                roic = f.get("roic")
                if roic is not None and roic != 0:
                    roics.append(roic)
                fcf = f.get("fcf_margin")
                if fcf is not None and fcf != 0:
                    fcfs.append(fcf)
            sector_returns[sector] = rets
            sector_roic[sector] = roics
            sector_fcf[sector] = fcfs

        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            md = ctx.market_data.get(ticker, {})
            sector = f.get("sector", "Unknown")

            sub_scores = []
            data_points = 0
            meta: dict = {"sector": sector, "peer_count": len(by_sector.get(sector, []))}

            ret_20d = md.get("return_20d")
            if ret_20d is not None and sector_returns.get(sector):
                pct = _percentile(ret_20d, sector_returns[sector])
                sub_scores.append(pct)
                meta["momentum_pct"] = round(pct, 3)
                data_points += 1

            roic = f.get("roic")
            if roic is not None and roic != 0 and sector_roic.get(sector):
                pct = _percentile(roic, sector_roic[sector])
                sub_scores.append(pct)
                meta["roic_pct"] = round(pct, 3)
                data_points += 1

            fcf_m = f.get("fcf_margin")
            if fcf_m is not None and fcf_m != 0 and sector_fcf.get(sector):
                pct = _percentile(fcf_m, sector_fcf[sector])
                sub_scores.append(pct)
                meta["fcf_pct"] = round(pct, 3)
                data_points += 1

            # Nowcast attention boost
            nowcast = (ctx.nowcast or {}).get(ticker)
            if nowcast:
                kpi = nowcast.get("kpi_surprise")
                if kpi is not None and kpi != 0:
                    attention = 0.5 + kpi * 0.3
                    sub_scores.append(max(min(attention, 1.0), 0.0))
                    data_points += 1

            if not sub_scores:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_peer_data"}))
                continue

            score = sum(sub_scores) / len(sub_scores)
            peer_count = len(by_sector.get(sector, []))
            confidence = min(0.3 + 0.1 * data_points + 0.1 * min(peer_count / 10, 1.0), 0.85)

            results.append(SignalOutput(
                ticker=ticker,
                score=round(max(min(score, 1.0), 0.0), 4),
                confidence=round(confidence, 3),
                metadata=meta,
            ))
        return results
