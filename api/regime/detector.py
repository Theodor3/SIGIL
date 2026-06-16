"""Regime detector — classifies market state from context data."""
from __future__ import annotations

from datetime import date

from api.regime.models import RegimeSnapshot

REGIME_DEFAULTS = {
    "risk_on": {"exposure": 0.75},
    "risk_off": {"exposure": 0.35},
    "high_vol": {"exposure": 0.50},
    "trend_growth": {"exposure": 0.90},
}


async def detect_regime(market_context: dict, as_of: date) -> RegimeSnapshot:
    """Classify market regime from daily context data.

    Port of V1's run_regime_model.mjs decision tree.
    Placeholder until full market context builder is wired up in Phase 3.
    """
    regime_id = "risk_on"
    confidence = 0.5

    return RegimeSnapshot(
        as_of_date=as_of,
        regime_id=regime_id,
        confidence=confidence,
        recommended_gross_exposure=REGIME_DEFAULTS[regime_id]["exposure"],
    )
