"""Regime detector — classifies market state from context data.

Port of V1's run_regime_model.mjs decision tree. Uses SPY/QQQ returns,
VIX levels, realized volatility, and breadth to classify into one of:
risk_on, risk_off, high_vol, trend_growth.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from api.regime.models import RegimeSnapshot

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "regime_policy.json"

DEFAULTS = {
    "thresholds": {
        "risk_off_avg20d": -0.02,
        "high_vol_5d_abs": 0.03,
        "trend_growth_qqq20d": 0.05,
        "trend_growth_spread_5d": 0.008,
        "vix_high": 22,
        "vix_risk_off": 28,
        "vix_change_5d_high": 0.12,
        "realized_vol_high": 0.24,
        "realized_vol_risk_off": 0.3,
        "trend_growth_vix_max": 20,
        "trend_growth_realized_vol_max": 0.22,
        "breadth_positive_ratio": 0.6,
        "breadth_negative_ratio": 0.4,
    },
    "exposure": {
        "risk_off": 0.35,
        "high_vol": 0.50,
        "risk_on": 0.75,
        "trend_growth": 0.90,
    },
    "factor_tilts": {
        "risk_off": {"quality": 1.2, "growth": 0.8, "alt_momentum": 0.75, "peer_relative": 0.95, "value": 1.15},
        "high_vol": {"quality": 1.1, "growth": 0.85, "alt_momentum": 0.7, "peer_relative": 0.9, "value": 1.05},
        "risk_on": {"quality": 1.0, "growth": 1.0, "alt_momentum": 1.0, "peer_relative": 1.0, "value": 1.0},
        "trend_growth": {"quality": 0.95, "growth": 1.2, "alt_momentum": 1.15, "peer_relative": 1.05, "value": 0.9},
    },
}


def _load_policy() -> dict:
    try:
        raw = json.loads(_CONFIG_PATH.read_text())
        return {
            "thresholds": {**DEFAULTS["thresholds"], **(raw.get("thresholds") or {})},
            "exposure": {**DEFAULTS["exposure"], **(raw.get("exposure") or {})},
            "factor_tilts": {**DEFAULTS["factor_tilts"], **(raw.get("factor_tilts") or {})},
        }
    except Exception:
        return DEFAULTS


def policy_for(regime_id: str) -> tuple[float, dict[str, float]]:
    """Recommended gross exposure and factor tilts for a regime.

    Callers that rebuild a RegimeSnapshot outside detect_regime() must go
    through this rather than reading DEFAULTS directly — DEFAULTS is only the
    fallback for a missing or unreadable regime_policy.json, so reading it
    means edits to that file silently skip your code path.
    """
    policy = _load_policy()
    return (
        policy["exposure"].get(regime_id, 0.75),
        policy["factor_tilts"].get(regime_id, {}),
    )


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _classify(ctx: dict, policy: dict) -> tuple[str, float, str, str]:
    """Decision tree: returns (regime_id, confidence, vol_state, breadth_state)."""
    t = policy["thresholds"]

    spy5 = ctx.get("spy_return_5d", 0) or 0
    qqq5 = ctx.get("qqq_return_5d", 0) or 0
    spy20 = ctx.get("spy_return_20d", 0) or 0
    qqq20 = ctx.get("qqq_return_20d", 0) or 0
    vix = ctx.get("vix_close")
    vix_change_5d = ctx.get("vix_change_5d", 0) or 0
    spy_rvol = ctx.get("spy_realized_vol_20d", 0) or 0
    qqq_rvol = ctx.get("qqq_realized_vol_20d", 0) or 0
    sector_pos_ratio = ctx.get("sector_positive_ratio_20d")

    avg20 = (spy20 + qqq20) / 2
    abs5 = max(abs(spy5), abs(qqq5))
    spread5 = qqq5 - spy5
    realized_vol = max(spy_rvol, qqq_rvol)

    breadth_positive = sector_pos_ratio is not None and sector_pos_ratio >= t["breadth_positive_ratio"]
    breadth_negative = sector_pos_ratio is not None and sector_pos_ratio <= t["breadth_negative_ratio"]

    vol_elevated = (
        abs5 >= t["high_vol_5d_abs"]
        or (vix is not None and vix >= t["vix_high"])
        or realized_vol >= t["realized_vol_high"]
        or vix_change_5d >= t["vix_change_5d_high"]
    )
    vol_risk_off = (vix is not None and vix >= t["vix_risk_off"]) or realized_vol >= t["realized_vol_risk_off"]

    # Decision tree
    regime_id = "risk_on"
    if avg20 <= t["risk_off_avg20d"] or (vol_risk_off and avg20 < 0):
        regime_id = "risk_off"
    elif vol_elevated and not breadth_positive:
        regime_id = "high_vol"
    elif (
        qqq20 >= t["trend_growth_qqq20d"]
        and spread5 >= t["trend_growth_spread_5d"]
        and (vix is None or vix <= t["trend_growth_vix_max"])
        and realized_vol <= t["trend_growth_realized_vol_max"]
        and not breadth_negative
    ):
        regime_id = "trend_growth"

    vol_state = "stressed" if vol_risk_off else ("elevated" if vol_elevated else "normal")
    if breadth_positive:
        breadth_state = "broad_positive"
    elif breadth_negative:
        breadth_state = "broad_negative"
    elif spy20 >= 0 and qqq20 >= 0:
        breadth_state = "mixed_positive"
    elif spy20 < 0 and qqq20 < 0:
        breadth_state = "mixed_negative"
    else:
        breadth_state = "mixed"

    # Confidence calculation
    vix_signal = max(0, (vix - 15) / 20) if vix is not None else 0
    rvol_signal = max(0, realized_vol / 0.35)
    breadth_signal = 0.2 if breadth_positive else (0.25 if breadth_negative else 0.1)
    confidence = _clamp(
        abs(avg20) * 7 + abs(spread5) * 6 + abs(qqq5) * 4 + vix_signal * 0.8 + rvol_signal * 0.6 + breadth_signal,
        0.3,
        0.95,
    )

    return regime_id, confidence, vol_state, breadth_state


async def detect_regime(market_context: dict, as_of: date) -> RegimeSnapshot:
    """Classify market regime from daily context data."""
    policy = _load_policy()

    if not market_context:
        return RegimeSnapshot(
            as_of_date=as_of,
            regime_id="risk_on",
            confidence=0.5,
            recommended_gross_exposure=policy["exposure"]["risk_on"],
            factor_tilts=policy["factor_tilts"].get("risk_on", {}),
        )

    regime_id, confidence, vol_state, breadth_state = _classify(market_context, policy)
    tilts = policy["factor_tilts"].get(regime_id, {})
    exposure = policy["exposure"].get(regime_id, 0.75)

    return RegimeSnapshot(
        as_of_date=as_of,
        regime_id=regime_id,
        confidence=confidence,
        recommended_gross_exposure=exposure,
        vol_state=vol_state,
        breadth_state=breadth_state,
        factor_tilts=tilts,
        metadata={
            "spy_20d": market_context.get("spy_return_20d"),
            "qqq_20d": market_context.get("qqq_return_20d"),
            "vix": market_context.get("vix_close"),
        },
    )
