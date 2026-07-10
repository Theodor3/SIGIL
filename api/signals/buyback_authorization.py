"""Buyback authorization signal — board-approved repurchase programs.

Forward-looking counterpart to buyback_yield: buyback_yield measures
dollars already spent (trailing cash-flow statement), this measures
dollars a board just committed. A fresh authorization worth a meaningful
slice of market cap is management signaling undervaluation with capital.

CANDIDATE SIGNAL — default_weight is 0.0. Predictions are recorded and
graded like any signal, but it has zero portfolio influence until its
Lab backtest and forward record clear the promotion gates.
"""
from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

# Authorization worth this fraction of market cap saturates the tilt
AUTH_SATURATION = 0.08
# Signal decays linearly to nothing over this many days post-announcement
DECAY_DAYS = 180
MAX_TILT = 0.35
# Confirmed authorization but unparseable amount: small flat tilt
UNKNOWN_AMOUNT_TILT = 0.08


class BuybackAuthorizationSignal(Signal):
    @property
    def name(self) -> str:
        return "buyback_authorization"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.0  # candidate: must earn weight through the Lab

    @property
    def category(self) -> str:
        return "event"

    @property
    def description(self) -> str:
        return "Board-authorized share repurchase programs as % of market cap — forward-looking capital-return commitment"

    @property
    def tags(self) -> list[str]:
        return ["event", "capital-return", "candidate"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            auth = ctx.buyback_authorizations.get(ticker)
            if not auth:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "no_authorization"}))
                continue

            try:
                announced = date.fromisoformat(auth.get("announced") or "")
            except (ValueError, TypeError):
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "bad_date"}))
                continue

            age_days = (ctx.as_of_date - announced).days
            decay = max(0.0, 1.0 - age_days / DECAY_DAYS)
            if decay <= 0:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "expired", "age_days": age_days}))
                continue

            market_cap = (ctx.fundamentals.get(ticker) or {}).get("market_cap")
            usd = auth.get("authorized_usd")

            meta = {
                "announced": auth.get("announced"),
                "age_days": age_days,
                "authorized_usd": usd,
            }

            # Long-only tilt: an authorization is never bearish, and its
            # absence is neutral, never a short
            if usd and market_cap and market_cap > 0:
                auth_pct = usd / market_cap
                tilt = min(auth_pct / AUTH_SATURATION, 1.0)
                score = 0.5 + MAX_TILT * tilt * decay
                confidence = min(0.9, 0.25 + 0.65 * decay)
                meta["auth_pct_of_mcap"] = round(auth_pct, 4)
            else:
                score = 0.5 + UNKNOWN_AMOUNT_TILT * decay
                confidence = min(0.5, 0.15 + 0.35 * decay)
                meta["amount_known"] = False

            results.append(SignalOutput(
                ticker=ticker,
                score=round(score, 4),
                confidence=round(confidence, 3),
                metadata=meta,
            ))
        return results
