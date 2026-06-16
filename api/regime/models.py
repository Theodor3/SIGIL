from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class RegimeSnapshot:
    as_of_date: date
    regime_id: str  # risk_on, risk_off, high_vol, trend_growth
    confidence: float
    recommended_gross_exposure: float
    vol_state: str = ""
    breadth_state: str = ""
    sector_leadership: str = ""
    factor_tilts: dict[str, float] = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)
