"""Data source registry — tracks all providers, their status, and config."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class SourceStatus(str, Enum):
    ACTIVE = "active"
    CONFIGURED = "configured"
    NO_KEY = "no_key"
    ERROR = "error"
    PENDING = "pending"


@dataclass
class DataSource:
    name: str
    provider: str
    description: str
    category: str  # fundamentals, market, alt, macro, earnings, universe
    requires_key: bool = False
    key_env_var: str = ""
    status: SourceStatus = SourceStatus.PENDING
    last_fetch: datetime | None = None
    last_fetch_count: int = 0
    last_error: str | None = None
    config: dict = field(default_factory=dict)


_sources: dict[str, DataSource] = {}


def register_source(source: DataSource):
    _sources[source.name] = source


def get_sources() -> dict[str, DataSource]:
    return _sources


def update_source_status(
    name: str,
    status: SourceStatus,
    fetch_count: int = 0,
    error: str | None = None,
):
    if name in _sources:
        _sources[name].status = status
        _sources[name].last_fetch = datetime.utcnow()
        _sources[name].last_fetch_count = fetch_count
        _sources[name].last_error = error


def init_default_sources():
    """Register all built-in data sources."""
    from api.config.settings import settings

    register_source(DataSource(
        name="yahoo_fundamentals",
        provider="Yahoo Finance",
        description="Company fundamentals — ROIC, FCF margin, revenue growth, valuation ratios, sector/industry",
        category="fundamentals",
        requires_key=False,
        status=SourceStatus.ACTIVE,
    ))
    register_source(DataSource(
        name="universe_screener",
        provider="Built-in",
        description="S&P 500 growth subset screener — filters 100 seed tickers to ~70 growth names",
        category="universe",
        requires_key=False,
        status=SourceStatus.ACTIVE,
    ))
    register_source(DataSource(
        name="finnhub_earnings",
        provider="Finnhub",
        description="Earnings calendar, company news, and historical earnings surprise data for PEAD signal",
        category="earnings",
        requires_key=True,
        key_env_var="FINNHUB_API_KEY",
        status=SourceStatus.ACTIVE if settings.finnhub_api_key else SourceStatus.NO_KEY,
    ))
    register_source(DataSource(
        name="polygon_market",
        provider="Polygon.io",
        description="Real-time and historical market data — OHLCV, technicals, reference data",
        category="market",
        requires_key=True,
        key_env_var="POLYGON_API_KEY",
        status=SourceStatus.ACTIVE if settings.polygon_api_key else SourceStatus.NO_KEY,
    ))
    register_source(DataSource(
        name="wikipedia_pageviews",
        provider="Wikipedia / Wikimedia API",
        description="Daily pageview counts for company pages — alt data signal for retail attention",
        category="alt",
        requires_key=False,
        status=SourceStatus.ACTIVE,
        config={"coverage": "92% of universe (69/75 tickers mapped)"},
    ))
    register_source(DataSource(
        name="gdelt_news",
        provider="GDELT Project",
        description="Global news sentiment and volume — alt data signal for media attention shifts",
        category="alt",
        requires_key=False,
        status=SourceStatus.ACTIVE,
        config={"note": "Rate-limited, uses exponential backoff"},
    ))
    register_source(DataSource(
        name="fred_macro",
        provider="FRED (St. Louis Fed)",
        description="Macro indicators — yield curve (T10Y2Y), high-yield spread, dollar index, VIX",
        category="macro",
        requires_key=True,
        key_env_var="FRED_API_KEY",
        status=SourceStatus.ACTIVE if settings.fred_api_key else SourceStatus.NO_KEY,
        config={"series": ["T10Y2Y", "BAMLH0A0HYM2", "DTWEXBGS", "VIXCLS"]},
    ))
    register_source(DataSource(
        name="alpaca_account",
        provider="Alpaca",
        description="Brokerage account data — positions, balances, order history for paper/live trading",
        category="execution",
        requires_key=True,
        key_env_var="ALPACA_API_KEY",
        status=SourceStatus.ACTIVE if settings.alpaca_api_key else SourceStatus.NO_KEY,
    ))
