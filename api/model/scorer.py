"""Alpha model — group-based weighting, regime tilts, gating, ranking."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from api.regime.models import RegimeSnapshot
from api.signals.base import SignalOutput

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "alpha_model.json"


@dataclass
class ScoredTicker:
    ticker: str
    final_score: float
    confidence: float
    signal_scores: dict[str, float]
    eligible: bool
    gate_flags: dict[str, bool]


def _resolve_weights(config: dict) -> dict[str, float]:
    """Convert group-based config into flat signal weights that sum to ~1.0."""
    groups = config.get("groups")
    if not groups:
        raw = config.get("weights", {})
        total = sum(raw.values()) or 1.0
        return {k: v / total for k, v in raw.items()}

    flat: dict[str, float] = {}
    for group_name, group in groups.items():
        budget = group["budget"]
        signals = group["signals"]
        rel_total = sum(signals.values()) or 1.0
        for sig_name, rel_weight in signals.items():
            flat[sig_name] = budget * (rel_weight / rel_total)
    return flat


def load_weights() -> dict[str, float]:
    """Load and resolve weights from alpha_model.json."""
    with open(_CONFIG_PATH) as f:
        config = json.load(f)
    return _resolve_weights(config)


def score_universe(
    signal_outputs: dict[str, list[SignalOutput]],
    weights: dict[str, float],
    regime: RegimeSnapshot,
    gates: dict | None = None,
) -> list[ScoredTicker]:
    """Combine all signal outputs into a ranked universe using group-based weights."""
    gates = gates or {}
    min_confidence = gates.get("min_confidence", 0.58)

    resolved = load_weights()
    # Merge: use resolved weights, but let caller override for any signal not in config
    for sig_name in weights:
        if sig_name not in resolved:
            resolved[sig_name] = weights[sig_name]

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

        for sig_name, weight in resolved.items():
            out = scores.get(sig_name)
            if out:
                tilt = regime.factor_tilts.get(sig_name, 1.0)
                weighted_sum += out.score * weight * tilt
                total_weight += weight
                signal_scores[sig_name] = round(out.score, 4)
                if out.confidence > 0:
                    confidences.append(out.confidence)

        final = weighted_sum / max(total_weight, 0.01)
        avg_conf = sum(confidences) / max(len(confidences), 1) if confidences else 0.6
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
