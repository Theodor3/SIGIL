"""Insider pattern break — the change in insider behavior, not the behavior.

Most insider selling is routine (scheduled plans, diversification) and
carries little information. The information is in the *break* from routine:

  Bullish:  a routine seller goes quiet — their regular selling cadence
            stops, suggesting they want to keep shares ahead of something
            good. Also: multiple distinct insiders buying within a short
            window (cluster buys are the strongest documented insider signal).

  Bearish:  an insider with no selling history suddenly starts selling
            (discretionary, not routine), or 3+ distinct insiders sell
            within a short window.

Needs 12 months of transaction history (ctx.insider_transactions) to
establish per-insider cadence before calling anything a break.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

# An insider is a "routine seller" with >= this many sales spread over
# >= MIN_ROUTINE_SPAN_DAYS — enough cadence to make silence meaningful
MIN_ROUTINE_SALES = 4
MIN_ROUTINE_SPAN_DAYS = 120
# Quiet = no sale for max(QUIET_FLOOR_DAYS, 2x their median gap)
QUIET_FLOOR_DAYS = 60
# Windows for clusters and "new seller" detection
CLUSTER_WINDOW_DAYS = 30
NEW_SELLER_WINDOW_DAYS = 45
CLUSTER_SELL_MIN = 3
CLUSTER_BUY_MIN = 2


def _parse(d: str) -> date | None:
    try:
        return date.fromisoformat(d[:10])
    except (ValueError, TypeError, IndexError):
        return None


def _is_sale(t: dict) -> bool:
    code = (t.get("code") or "").upper()
    if code:
        return code == "S"
    tx = (t.get("transaction_type") or "").lower()
    return "sale" in tx or "sell" in tx or "disposition" in tx


def _is_buy(t: dict) -> bool:
    code = (t.get("code") or "").upper()
    if code:
        return code == "P"
    tx = (t.get("transaction_type") or "").lower()
    return "purchase" in tx or "buy" in tx or "acquisition" in tx


class InsiderPatternBreakSignal(Signal):
    @property
    def name(self) -> str:
        return "insider_pattern_break"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.05

    @property
    def category(self) -> str:
        return "event"

    @property
    def description(self) -> str:
        return ("Detects breaks in insider behavior — routine sellers going quiet (bullish), "
                "first-time sellers and sell clusters (bearish), buy clusters (bullish)")

    @property
    def tags(self) -> list[str]:
        return ["event", "insider", "behavioral"]

    def _analyze(self, transactions: list[dict], today: date) -> dict:
        """Extract pattern evidence from one ticker's 12-month history."""
        sales_by_insider: dict[str, list[date]] = {}
        buys_by_insider: dict[str, list[date]] = {}
        for t in transactions:
            d = _parse(t.get("date") or "")
            if d is None:
                continue
            name = (t.get("name") or "").strip().upper() or "UNKNOWN"
            if _is_sale(t):
                sales_by_insider.setdefault(name, []).append(d)
            elif _is_buy(t):
                buys_by_insider.setdefault(name, []).append(d)

        quiet_routine_sellers: list[str] = []
        new_sellers: list[str] = []
        recent_sellers: set[str] = set()
        new_seller_cutoff = today - timedelta(days=NEW_SELLER_WINDOW_DAYS)
        cluster_cutoff = today - timedelta(days=CLUSTER_WINDOW_DAYS)

        for name, dates in sales_by_insider.items():
            dates.sort()
            last_sale = dates[-1]
            if last_sale >= cluster_cutoff:
                recent_sellers.add(name)

            span = (last_sale - dates[0]).days
            if len(dates) >= MIN_ROUTINE_SALES and span >= MIN_ROUTINE_SPAN_DAYS:
                gaps = sorted(
                    (dates[i] - dates[i - 1]).days for i in range(1, len(dates))
                )
                median_gap = gaps[len(gaps) // 2]
                quiet_threshold = max(QUIET_FLOOR_DAYS, 2 * median_gap)
                if (today - last_sale).days > quiet_threshold:
                    quiet_routine_sellers.append(name)
            elif dates[0] >= new_seller_cutoff:
                # first recorded sale in 12 months landed in the last 45d
                new_sellers.append(name)

        cluster_buyers = {
            name for name, dates in buys_by_insider.items()
            if any(d >= cluster_cutoff for d in dates)
        }

        return {
            "quiet_routine_sellers": quiet_routine_sellers,
            "new_sellers": new_sellers,
            "sell_cluster": len(recent_sellers) >= CLUSTER_SELL_MIN,
            "buy_cluster": len(cluster_buyers) >= CLUSTER_BUY_MIN,
            "sell_cluster_size": len(recent_sellers),
            "buy_cluster_size": len(cluster_buyers),
        }

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        today = ctx.as_of_date
        results = []
        for ticker in ctx.universe:
            transactions = ctx.insider_transactions.get(ticker, [])
            if not transactions:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_data"}))
                continue

            ev = self._analyze(transactions, today)

            score = 0.5
            evidence = 0
            if ev["quiet_routine_sellers"]:
                score += min(0.12 * len(ev["quiet_routine_sellers"]), 0.24)
                evidence += 1
            if ev["buy_cluster"]:
                score += 0.15
                evidence += 1
            if ev["new_sellers"]:
                score -= min(0.10 * len(ev["new_sellers"]), 0.20)
                evidence += 1
            if ev["sell_cluster"]:
                score -= 0.15
                evidence += 1

            if evidence == 0:
                # history exists but no pattern break — no view
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_break"}))
                continue

            score = min(max(score, 0.05), 0.95)
            confidence = min(0.35 + 0.12 * evidence, 0.75)
            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 3),
                confidence=round(confidence, 3),
                metadata={
                    "quiet_routine_sellers": ev["quiet_routine_sellers"][:5],
                    "new_sellers": ev["new_sellers"][:5],
                    "sell_cluster_size": ev["sell_cluster_size"],
                    "buy_cluster_size": ev["buy_cluster_size"],
                },
            ))
        return results
