from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class PipelineContext:
    """Immutable snapshot of all data needed by signals for one pipeline run."""

    as_of_date: date
    universe: list[str] = field(default_factory=list)

    # Keyed by ticker
    fundamentals: dict[str, dict] = field(default_factory=dict)
    market_data: dict[str, dict] = field(default_factory=dict)
    earnings_calendar: dict[str, date] = field(default_factory=dict)
    earnings_history: dict[str, list[dict]] = field(default_factory=dict)
    nowcast: dict[str, dict] = field(default_factory=dict)

    # Finnhub extras
    insider_transactions: dict[str, list[dict]] = field(default_factory=dict)
    analyst_estimates: dict[str, dict] = field(default_factory=dict)

    # FMP enrichment
    price_targets: dict[str, dict] = field(default_factory=dict)
    shares_float: dict[str, dict] = field(default_factory=dict)
    forward_estimates: dict[str, dict] = field(default_factory=dict)

    # Market-wide
    macro: dict = field(default_factory=dict)
    benchmarks: dict = field(default_factory=dict)
