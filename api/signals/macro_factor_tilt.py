"""Macro factor tilt — adjusts stock scores based on macro regime and factor exposure."""
from __future__ import annotations

from typing import TYPE_CHECKING

from api.signals.base import Signal, SignalOutput

if TYPE_CHECKING:
    from api.data.context import PipelineContext

# Macro thresholds for regime classification
CPI_HOT = 0.035       # YoY CPI above 3.5% = inflationary
CPI_COOL = 0.02       # YoY CPI below 2.0% = deflationary pressure
UNEMPLOYMENT_HIGH = 5.0
UNEMPLOYMENT_LOW = 3.8
VIX_HIGH = 25
VIX_LOW = 15


def _classify_macro(macro: dict) -> tuple[str, dict, dict]:
    """Classify macro environment into a regime with factor tilts."""
    cpi_yoy = macro.get("cpi_all_urban_yoy") or macro.get("cpi_yoy")
    unemployment = macro.get("unemployment_rate_bls") or macro.get("unemployment_rate")
    vix = macro.get("vix")
    fed_funds = macro.get("fed_funds_rate")
    yield_curve = macro.get("T10Y2Y")
    ppi_yoy = macro.get("ppi_final_demand_yoy")

    meta = {
        "cpi_yoy": cpi_yoy,
        "unemployment": unemployment,
        "vix": vix,
        "fed_funds": fed_funds,
        "yield_curve": yield_curve,
    }

    # Default neutral tilts
    tilts = {"quality": 0.0, "value": 0.0, "growth": 0.0, "momentum": 0.0, "defensive": 0.0}

    if cpi_yoy is not None and cpi_yoy > CPI_HOT:
        # Inflationary: favor value + quality, penalize growth
        tilts["value"] += 0.15
        tilts["quality"] += 0.10
        tilts["growth"] -= 0.15
        meta["inflation_regime"] = "hot"
    elif cpi_yoy is not None and cpi_yoy < CPI_COOL:
        # Disinflation: favor growth
        tilts["growth"] += 0.15
        tilts["value"] -= 0.10
        meta["inflation_regime"] = "cool"
    else:
        meta["inflation_regime"] = "neutral"

    if unemployment is not None and unemployment > UNEMPLOYMENT_HIGH:
        # Weakening labor: favor defensive + quality, penalize momentum
        tilts["defensive"] += 0.15
        tilts["quality"] += 0.10
        tilts["momentum"] -= 0.10
        meta["labor_regime"] = "weak"
    elif unemployment is not None and unemployment < UNEMPLOYMENT_LOW:
        # Strong labor: favor momentum + growth
        tilts["momentum"] += 0.10
        tilts["growth"] += 0.05
        meta["labor_regime"] = "strong"
    else:
        meta["labor_regime"] = "neutral"

    if vix is not None and vix > VIX_HIGH:
        # High vol: favor quality + defensive, penalize growth
        tilts["quality"] += 0.15
        tilts["defensive"] += 0.10
        tilts["growth"] -= 0.10
        tilts["momentum"] -= 0.10
        meta["vol_regime"] = "high"
    elif vix is not None and vix < VIX_LOW:
        # Low vol: favor momentum + growth
        tilts["momentum"] += 0.10
        tilts["growth"] += 0.10
        meta["vol_regime"] = "low"
    else:
        meta["vol_regime"] = "neutral"

    # Inverted yield curve = recession signal
    if yield_curve is not None and yield_curve < 0:
        tilts["quality"] += 0.15
        tilts["defensive"] += 0.15
        tilts["growth"] -= 0.10
        tilts["value"] -= 0.05
        meta["curve_regime"] = "inverted"
    else:
        meta["curve_regime"] = "normal"

    return "macro_tilt", tilts, meta


def _factor_exposure(f: dict) -> dict[str, float]:
    """Estimate a stock's factor exposures from fundamentals."""
    exposures = {}

    roic = f.get("roic", 0) or 0
    fcf_margin = f.get("fcf_margin", 0) or 0
    exposures["quality"] = min((roic + fcf_margin) / 0.6, 1.0)

    pe = f.get("trailing_pe")
    if pe and pe > 0:
        exposures["value"] = max(0, min(1.0 - (pe - 10) / 40, 1.0))
    else:
        exposures["value"] = 0.5

    rev_growth = f.get("revenue_cagr_3y", 0) or 0
    exposures["growth"] = min(max(rev_growth, 0) / 0.5, 1.0)

    # Defensive proxy: low debt, high dividend
    debt_ebitda = f.get("debt_to_ebitda")
    div_yield = f.get("dividend_yield", 0) or 0
    debt_score = max(0, 1.0 - (debt_ebitda or 0) / 3.0) if debt_ebitda is not None else 0.5
    exposures["defensive"] = 0.6 * debt_score + 0.4 * min(div_yield / 0.03, 1.0)

    exposures["momentum"] = 0.5  # neutral default, overridden by price data

    return exposures


class MacroFactorTiltSignal(Signal):
    @property
    def name(self) -> str:
        return "macro_factor_tilt"

    @property
    def version(self) -> str:
        return "1.0"

    @property
    def default_weight(self) -> float:
        return 0.08

    @property
    def category(self) -> str:
        return "composite"

    @property
    def description(self) -> str:
        return "Tilts stock scores based on macro regime (CPI, unemployment, VIX, yield curve) and factor exposure"

    @property
    def tags(self) -> list[str]:
        return ["macro", "regime", "factor-rotation"]

    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        _, tilts, regime_meta = _classify_macro(ctx.macro)

        has_macro = any(v != 0.0 for v in tilts.values())
        if not has_macro:
            return [SignalOutput(t, 0.5, 0.0, {"reason": "no_macro_data"}) for t in ctx.universe]

        results = []
        for ticker in ctx.universe:
            f = ctx.fundamentals.get(ticker, {})
            if not f:
                results.append(SignalOutput(ticker, 0.5, 0.0, {}))
                continue

            exposures = _factor_exposure(f)

            # Override momentum exposure with actual price momentum
            md = ctx.market_data.get(ticker, {})
            closes = md.get("closes", [])
            if len(closes) >= 20:
                ret_20d = (closes[-1] - closes[-20]) / closes[-20]
                exposures["momentum"] = min(max(ret_20d / 0.20 + 0.5, 0), 1.0)

            # Dot product: how aligned is this stock's factor profile with the macro tilts?
            alignment = sum(
                exposures.get(factor, 0.5) * tilt
                for factor, tilt in tilts.items()
            )

            # Normalize to 0-1 range (alignment typically ranges from -0.3 to +0.3)
            score = min(max(alignment / 0.4 + 0.5, 0.0), 1.0)

            # Confidence based on how much macro data we have
            data_count = sum(1 for v in regime_meta.values() if v is not None and v != "neutral" and v != "normal")
            confidence = min(data_count / 4.0, 1.0)

            meta = {
                "exposures": {k: round(v, 3) for k, v in exposures.items()},
                "alignment": round(alignment, 4),
                **regime_meta,
            }

            results.append(SignalOutput(
                ticker=ticker,
                score=score,
                confidence=confidence,
                metadata=meta,
            ))

        return results
