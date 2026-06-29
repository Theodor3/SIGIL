"""Insider activity signal — net insider buying/selling from SEC filings."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class InsiderSignal(Signal):
    @property
    def name(self) -> str:
        return "insider"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.06

    @property
    def category(self) -> str:
        return "event"

    @property
    def description(self) -> str:
        return "Tracks net insider buying and selling from SEC filings — insider purchases are a strong bullish signal"

    @property
    def tags(self) -> list[str]:
        return ["event", "insider", "sentiment"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            transactions = ctx.insider_transactions.get(ticker, [])
            if not transactions:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            buy_value = 0.0
            sell_value = 0.0
            buy_count = 0
            sell_count = 0

            for t in transactions:
                change = t.get("change", 0) or 0
                tx_type = (t.get("transaction_type") or "").lower()
                if "purchase" in tx_type or "buy" in tx_type or "acquisition" in tx_type:
                    buy_value += abs(change)
                    buy_count += 1
                elif "sale" in tx_type or "sell" in tx_type or "disposition" in tx_type:
                    sell_value += abs(change)
                    sell_count += 1

            total = buy_value + sell_value
            if total == 0:
                results.append(SignalOutput(ticker, 0.5, 0.1, {"reason": "no_trades"}))
                continue

            net_ratio = (buy_value - sell_value) / total
            score = max((net_ratio + 1) / 2, 0)

            tx_count = buy_count + sell_count
            confidence = min(0.4 + 0.1 * tx_count, 0.85)

            results.append(SignalOutput(
                ticker=ticker,
                score=min(score, 1.0),
                confidence=confidence,
                metadata={
                    "buy_count": buy_count,
                    "sell_count": sell_count,
                    "buy_value": round(buy_value),
                    "sell_value": round(sell_value),
                    "net_ratio": round(net_ratio, 3),
                },
            ))
        return results
