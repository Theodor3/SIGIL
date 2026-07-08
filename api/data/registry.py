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
        description="Multi-index screener — filters S&P 500 + small/mid cap (~2500 tickers) to top 300 by quality",
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
        provider="Yahoo Finance",
        description="Market data — Yahoo batch download for per-ticker OHLCV plus SPY/QQQ/sector-ETF benchmarks",
        category="market",
        requires_key=False,
        status=SourceStatus.ACTIVE,
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
        name="fmp_fundamentals",
        provider="Financial Modeling Prep",
        description="Company fundamentals — ROIC, margins, ratios, cash flow. Supplements Yahoo with cleaner data",
        category="fundamentals",
        requires_key=True,
        key_env_var="FMP_API_KEY",
        status=SourceStatus.ACTIVE if settings.fmp_api_key else SourceStatus.NO_KEY,
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
    register_source(DataSource(
        name="tiingo_prices",
        provider="Tiingo",
        description="Daily adjusted prices — backup price source filling Yahoo gaps",
        category="market",
        requires_key=True,
        key_env_var="TIINGO_API_KEY",
        status=SourceStatus.ACTIVE if settings.tiingo_api_key else SourceStatus.NO_KEY,
    ))
    register_source(DataSource(
        name="alphavantage_earnings",
        provider="Alpha Vantage",
        description="Quarterly earnings surprise history — supplements Finnhub earnings data",
        category="earnings",
        requires_key=True,
        key_env_var="ALPHA_VANTAGE_API_KEY",
        status=SourceStatus.ACTIVE if settings.alpha_vantage_api_key else SourceStatus.NO_KEY,
        config={"note": "Free tier: 25 req/day — only fetches top 20 tickers"},
    ))
    register_source(DataSource(
        name="edgar_filings",
        provider="SEC EDGAR",
        description="Filing red flags — NT late filings, auditor changes (8-K 4.01), restatements (8-K 4.02)",
        category="alt",
        requires_key=False,
        status=SourceStatus.ACTIVE,
        config={"note": "data.sec.gov submissions API, fair-use rate limited"},
    ))
    register_source(DataSource(
        name="bls_labor",
        provider="Bureau of Labor Statistics",
        description="CPI, core CPI, nonfarm payrolls, unemployment, PPI, hourly earnings + YoY changes",
        category="macro",
        requires_key=True,
        key_env_var="BLS_API_KEY",
        status=SourceStatus.ACTIVE if settings.bls_api_key else SourceStatus.NO_KEY,
    ))
