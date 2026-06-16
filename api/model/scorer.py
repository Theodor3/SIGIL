"""Alpha model — normalize signal outputs, apply weights, gate, rank."""
from __future__ import annotations

from dataclasses import dataclass

from api.regime.models import RegimeSnapshot
from api.signals.base import SignalOutput


@dataclass
class ScoredTicker:
    ticker: str
    final_score: float
    confidence: float
    signal_scores: dict[str, float]
    eligible: bool
    gate_flags: dict[str, bool]


def score_universe(
    signal_outputs: dict[str, list[SignalOutput]],
    weights: dict[str, float],
    regime: RegimeSnapshot,
    gates: dict | None = None,
) -> list[ScoredTicker]:
    """Combine all signal outputs into a ranked universe.

    Placeholder implementation — full normalization + gating in Phase 3.
    """
    gates = gates or {}
    min_confidence = gates.get("min_confidence", 0.58)

    tickers: set[str] = set()
    for outputs in signal_outputs.values():
        for out in outputs:
            tickers.add(out.ticker)

    signal_by_ticker: dict[str, dict[str, SignalOutput]] = {}
    for sig_name, outputs in signal_outputs.items():
        for out in outputs:
            signal_by_ticker.setdefault(out.ticker, {})[sig_name] = out

    results = []
    for ticker in sorted(tickers):
        scores = signal_by_ticker.get(ticker, {})
        weighted_sum = 0.0
        total_weight = 0.0
        signal_scores = {}
        confidences = []

        for sig_name, weight in weights.items():
            out = scores.get(sig_name)
            if out:
                tilt = regime.factor_tilts.get(sig_name, 1.0)
                weighted_sum += out.score * weight * tilt
                total_weight += weight
                signal_scores[sig_name] = round(out.score, 4)
                confidences.append(out.confidence)

        final = weighted_sum / max(total_weight, 0.01)
        avg_conf = sum(confidences) / max(len(confidences), 1)
        eligible = avg_conf >= min_confidence

        results.append(ScoredTicker(
            ticker=ticker,
            final_score=round(final, 6),
            confidence=round(avg_conf, 4),
            signal_scores=signal_scores,
            eligible=eligible,
            gate_flags={"confidence": avg_conf >= min_confidence},
        ))

    results.sort(key=lambda x: x.final_score, reverse=True)
    return results
