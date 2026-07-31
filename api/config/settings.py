from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///sigil_dev.db"
    redis_url: str = "redis://localhost:6379"

    polygon_api_key: str = ""
    finnhub_api_key: str = ""
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    fred_api_key: str = ""
    fmp_api_key: str = ""
    alpha_vantage_api_key: str = ""
    tiingo_api_key: str = ""
    bls_api_key: str = ""
    anthropic_api_key: str = ""
    demo_mode: bool = True
    auto_run_pipeline: bool = True
    auto_rebalance: bool = True
    pipeline_interval_hours: float = 6
    auth_password: str = ""
    paper_starting_equity: float = 100_000.0

    # Trading friction controls
    min_rebalance_interval_hours: float = 20
    rebalance_keep_rank: int = 50
    rebalance_max_turnover_pct: float = 0.25
    order_limit_collar_pct: float = 0.01
    # Feed real sectors to portfolio construction, making the 30% sector cap bind.
    # Off by default: the cap has never bound on a live book (sector data was
    # missing), so turning it on re-cuts real positions. Check the candidate spread
    # with GET /api/portfolio/sector-preview first — under 4 distinct sectors the
    # cap cannot reach fully invested and the remainder stays in cash.
    enforce_sector_cap: bool = False
    # Refuse to submit outside the regular session. A deploy restart fired a
    # rebalance pre-market on 2026-07-30: the arrival spread averaged 1580bps and
    # execution cost 329bps on 4 orders, against a delay leg of -0.67bps. The
    # spread was the whole cost, and it exists because the book is empty before
    # 09:30 ET.
    require_market_hours: bool = True
    # Skip any order whose arrival spread is wider than this. Second line of
    # defence: a name can be illiquid mid-session too, and crossing a spread this
    # wide costs more than any signal in the book earns. 300bps is far above a
    # normal spread for a $5M-ADV name and far below the 1580bps that triggered it.
    max_spread_bps: float = 300.0
    min_avg_dollar_volume: float = 5_000_000
    open_quiet_minutes: int = 15
    prediction_retention_days: int = 365
    context_snapshot_dir: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
