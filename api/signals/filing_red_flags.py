"""Filing red flags — discrete bearish events from SEC EDGAR.

Three of the cleanest negative signals in the market, all rare and all
nearly false-positive-free:

  8-K Item 4.02 — non-reliance on previously issued financials
                  (restatement): the worst of the three
  NT 10-K/10-Q  — "we will file late": strongly associated with
                  negative drift
  8-K Item 4.01 — auditor change: bad on average, context-dependent

Silent (no view) for companies with clean filings — this is an event
signal, not a ranking factor.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext


class FilingRedFlagsSignal(Signal):
    @property
    def name(self) -> str:
        return "filing_red_flags"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.05

    @property
    def category(self) -> str:
        return "risk"

    @property
    def description(self) -> str:
        return ("Flags discrete filing events — restatements (8-K 4.02), late filings (NT), "
                "and auditor changes (8-K 4.01) from SEC EDGAR")

    @property
    def tags(self) -> list[str]:
        return ["risk", "filings", "event"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        results = []
        for ticker in ctx.universe:
            flags = ctx.filing_flags.get(ticker)
            if flags is None:
                # not checked (no CIK match or EDGAR unavailable) — no view
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "unchecked"}))
                continue

            restatements = flags.get("restatements", [])
            nt_filings = flags.get("nt_filings", [])
            auditor_changes = flags.get("auditor_changes", [])

            # Severity wins; multiple flag types deepen conviction
            if restatements:
                score, confidence = 0.08, 0.9
            elif nt_filings:
                score, confidence = 0.12, 0.85
            elif auditor_changes:
                score, confidence = 0.25, 0.7
            else:
                results.append(SignalOutput(ticker, 0.5, 0.0, {"reason": "clean"}))
                continue

            flag_types = sum(1 for f in (restatements, nt_filings, auditor_changes) if f)
            if flag_types > 1:
                score = max(score - 0.05, 0.02)
                confidence = min(confidence + 0.05, 0.95)

            results.append(SignalOutput(
                ticker=ticker,
                score=score,
                confidence=confidence,
                metadata={
                    "restatements": restatements[:3],
                    "nt_filings": nt_filings[:3],
                    "auditor_changes": auditor_changes[:3],
                },
            ))
        return results
