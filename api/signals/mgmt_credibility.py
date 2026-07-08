"""Management credibility — does this company deliver against expectations?

Serial sandbaggers (small, consistent beats quarter after quarter) keep
beating; serial missers keep missing. The information isn't in one
surprise — PEAD covers that — it's in the *track record*: beat rate and
the consistency of the surprise distribution over up to 8 quarters.

Uses ctx.earnings_history (actual vs consensus EPS with surprise %),
already fetched by the Finnhub provider. No new data source.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

MIN_QUARTERS = 6
# Surprise-% dispersion bands: tight = predictable management, wild = noise
TIGHT_STD = 12.0
ERRATIC_STD = 25.0


class MgmtCredibilitySignal(Signal):
    @property
    def name(self) -> str:
        return "mgmt_credibility"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.05

    @property
    def category(self) -> str:
        return "earnings"

    @property
    def description(self) -> str:
        return ("Management's track record vs consensus — consistent beaters score high, "
                "serial missers low; erratic surprise histories carry no signal")

    @property
    def tags(self) -> list[str]:
        return ["earnings", "credibility", "track-record"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            records = ctx.earnings_history.get(ticker, [])
            surprises = [
                r["surprise_pct"] for r in records
                if isinstance(r.get("surprise_pct"), (int, float))
            ]
            n = len(surprises)
            if n < MIN_QUARTERS:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "thin_history", "quarters": n}))
                continue

            beat_rate = sum(1 for s in surprises if s > 0) / n
            mean = sum(surprises) / n
            var = sum((s - mean) ** 2 for s in surprises) / n
            std = var ** 0.5

            if std > ERRATIC_STD:
                # unpredictable management is noise, not a direction
                results.append(SignalOutput(
                    ticker, 0.5, 0.0,
                    {"reason": "erratic", "std": round(std, 2), "beat_rate": round(beat_rate, 2)},
                ))
                continue

            # 0.25..0.75 from beat rate; full strength only with tight dispersion
            score = 0.5 + (beat_rate - 0.5) * 0.5
            consistency = 0.6 if std <= TIGHT_STD else 0.35
            confidence = round(consistency * (n / 8), 3)

            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 3),
                confidence=confidence,
                metadata={
                    "quarters": n,
                    "beat_rate": round(beat_rate, 3),
                    "mean_surprise_pct": round(mean, 2),
                    "std_surprise_pct": round(std, 2),
                },
            ))
        return results
