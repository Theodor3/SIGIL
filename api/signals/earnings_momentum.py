"""Earnings momentum composite — tracks trajectory of earnings surprises + analyst revisions."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class EarningsMomentumSignal(Signal):
    @property
    def name(self) -> str:
        return "earnings_momentum"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.10

    @property
    def category(self) -> str:
        return "event"

    @property
    def description(self) -> str:
        return "Composite of accelerating earnings surprises and improving analyst sentiment"

    @property
    def tags(self) -> list[str]:
        return ["earnings", "momentum", "composite"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            history = ctx.earnings_history.get(ticker, [])
            analyst = ctx.analyst_estimates.get(ticker, {})

            surprise_score = 0.0
            surprise_conf = 0.0
            analyst_score = 0.0
            analyst_conf = 0.0
            meta: dict = {}

            # --- Surprise trajectory ---
            surprises = [h.get("surprise_pct", 0) for h in history[:6] if h.get("surprise_pct") is not None]
            if len(surprises) >= 2:
                avg_surprise = sum(surprises) / len(surprises)
                recent_avg = sum(surprises[:2]) / 2
                older_avg = sum(surprises[2:]) / max(len(surprises[2:]), 1)

                # Acceleration: recent surprises getting bigger
                acceleration = recent_avg - older_avg if len(surprises) > 2 else 0
                # Consistency: what fraction are positive
                pos_rate = sum(1 for s in surprises if s > 0) / len(surprises)

                # Score: blend of level, acceleration, and consistency
                level_component = min(max(avg_surprise / 20.0, -0.5), 0.5) + 0.5
                accel_component = min(max(acceleration / 10.0, -0.5), 0.5) + 0.5
                consistency_component = pos_rate

                surprise_score = (
                    0.35 * level_component +
                    0.35 * accel_component +
                    0.30 * consistency_component
                )
                surprise_conf = min(len(surprises) / 4.0, 1.0)

                meta["avg_surprise"] = round(avg_surprise, 2)
                meta["recent_avg"] = round(recent_avg, 2)
                meta["acceleration"] = round(acceleration, 2)
                meta["pos_rate"] = round(pos_rate, 3)
                meta["quarters"] = len(surprises)

            # --- Analyst revision trajectory ---
            if analyst:
                buy = analyst.get("buy", 0) + analyst.get("strong_buy", 0)
                sell = analyst.get("sell", 0) + analyst.get("strong_sell", 0)
                hold = analyst.get("hold", 0)
                total = buy + sell + hold
                prev_buy = analyst.get("prev_buy", 0)
                prev_sell = analyst.get("prev_sell", 0)
                prev_hold = analyst.get("prev_hold", 0)
                prev_total = prev_buy + prev_sell + prev_hold

                if total > 0:
                    buy_ratio = buy / total
                    # Revision direction: are buy ratings increasing?
                    if prev_total > 0:
                        prev_buy_ratio = prev_buy / prev_total
                        revision_delta = buy_ratio - prev_buy_ratio
                    else:
                        revision_delta = 0

                    # Score: current sentiment + direction of change
                    sentiment_component = buy_ratio
                    revision_component = min(max(revision_delta * 5 + 0.5, 0), 1.0)

                    analyst_score = 0.6 * sentiment_component + 0.4 * revision_component
                    analyst_conf = min(total / 10.0, 1.0)

                    meta["buy_ratio"] = round(buy_ratio, 3)
                    meta["revision_delta"] = round(revision_delta, 4)

            # --- Composite ---
            if surprise_conf > 0 and analyst_conf > 0:
                # Both signals present — blend them
                score = 0.55 * surprise_score + 0.45 * analyst_score
                confidence = min(surprise_conf, analyst_conf) * 0.8 + max(surprise_conf, analyst_conf) * 0.2
                meta["blend"] = "full"
            elif surprise_conf > 0:
                score = surprise_score
                confidence = surprise_conf * 0.7
                meta["blend"] = "surprise_only"
            elif analyst_conf > 0:
                score = analyst_score
                confidence = analyst_conf * 0.6
                meta["blend"] = "analyst_only"
            else:
                score = 0.0
                confidence = 0.0
                meta["blend"] = "none"

            results.append(SignalOutput(
                ticker=ticker,
                score=max(0.0, min(score, 1.0)),
                confidence=max(0.0, min(confidence, 1.0)),
                metadata=meta,
            ))

        return results
