"""StockTwits retail sentiment signal — contrarian and momentum indicator."""
from __future__ import annotations

from api.data.context import PipelineContext
from api.signals.base import Signal, SignalOutput


class StockTwitsSentimentSignal(Signal):
    @property
    def name(self) -> str:
        return "stocktwits_sentiment"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.04

    @property
    def category(self) -> str:
        return "sentiment"

    @property
    def description(self) -> str:
        return "Retail sentiment from StockTwits — bullish consensus as contrarian/momentum factor"

    @property
    def tags(self) -> list[str]:
        return ["alt-data", "sentiment", "retail"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        sentiment_data = ctx.sentiment

        for ticker in ctx.universe:
            data = sentiment_data.get(ticker)
            if not data:
                results.append(SignalOutput(ticker, 0.0, 0.0, {}))
                continue

            bullish = data.get("bullish", 0) or 0
            bearish = data.get("bearish", 0) or 0
            total = bullish + bearish

            if total < 5:
                results.append(SignalOutput(ticker, 0.0, 0.0, {"reason": "too_few_messages"}))
                continue

            bull_ratio = bullish / total
            sentiment_raw = data.get("sentiment_score", 0) or 0

            # Contrarian: extreme bullish (>0.85) is bearish signal, moderate bullish is positive
            # Sweet spot: 0.55-0.75 bullish ratio = healthy conviction without euphoria
            if bull_ratio > 0.85:
                score = max(0, 0.3 - (bull_ratio - 0.85) * 3)
            elif bull_ratio > 0.55:
                score = 0.3 + (bull_ratio - 0.55) * 2.0
            elif bull_ratio > 0.40:
                score = 0.2
            else:
                score = max(0, 0.1 - (0.40 - bull_ratio) * 0.5)

            # Volume boost: more messages = more conviction in the signal
            volume_mult = min(1.5, 1.0 + (total - 5) / 100)
            score = min(1.0, score * volume_mult)

            confidence = min(1.0, total / 50)

            results.append(SignalOutput(ticker, round(score, 4), round(confidence, 4), {
                "bullish": bullish,
                "bearish": bearish,
                "total_messages": total,
                "bull_ratio": round(bull_ratio, 3),
                "sentiment_raw": sentiment_raw,
            }))

        return results
