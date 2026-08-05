import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint, JSON,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    regime_id: Mapped[str | None] = mapped_column(String(32))
    regime_confidence: Mapped[float | None] = mapped_column(Float)
    universe_size: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="running")
    error_message: Mapped[str | None] = mapped_column(Text)


class SignalPrediction(Base):
    __tablename__ = "signal_predictions"
    __table_args__ = (
        UniqueConstraint("run_id", "signal_name", "ticker"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("pipeline_runs.id"), nullable=False)
    run_date: Mapped[date] = mapped_column(Date, nullable=False)
    signal_name: Mapped[str] = mapped_column(String(64), nullable=False)
    signal_version: Mapped[str | None] = mapped_column(String(16))
    ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON)


class SignalEvaluation(Base):
    __tablename__ = "signal_evaluations"
    __table_args__ = (
        UniqueConstraint("prediction_id", "horizon_days"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    prediction_id: Mapped[int] = mapped_column(Integer, ForeignKey("signal_predictions.id"), nullable=False)
    horizon_days: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_return: Mapped[float | None] = mapped_column(Float)
    signal_correct: Mapped[bool | None] = mapped_column(Boolean)
    alpha_vs_benchmark: Mapped[float | None] = mapped_column(Float)
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime)


class RegimeHistory(Base):
    __tablename__ = "regime_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    regime_id: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    spy_20d_return: Mapped[float | None] = mapped_column(Float)
    vix_level: Mapped[float | None] = mapped_column(Float)
    breadth_state: Mapped[str | None] = mapped_column(String(32))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON)


class ScreeningCache(Base):
    """Persistent per-ticker screening fundamentals.

    FMP's free tier (~250 calls/day) can't re-screen the whole universe every
    run, and fundamentals change quarterly anyway — cache them and refresh a
    shuffled slice per run."""
    __tablename__ = "screening_cache"

    ticker: Mapped[str] = mapped_column(String(10), primary_key=True)
    data: Mapped[dict | None] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class WatchlistTicker(Base):
    """Force-included research tickers (e.g. a friend's holdings).

    Watchlist tickers flow through screening, every signal, grading, and
    Research — but are excluded from portfolio target construction. An
    empty table means the pipeline behaves exactly as if this feature
    didn't exist."""
    __tablename__ = "watchlist"

    ticker: Mapped[str] = mapped_column(String(10), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    note: Mapped[str | None] = mapped_column(String(120))


class EquitySnapshot(Base):
    """Hourly account equity record — the honest performance history.

    Returns and drawdowns are always computed from equity at read time,
    never stored, so a bug can't bake itself into the record."""
    __tablename__ = "equity_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    taken_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    equity: Mapped[float] = mapped_column(Float, nullable=False)
    cash: Mapped[float | None] = mapped_column(Float)
    positions_count: Mapped[int | None] = mapped_column(Integer)
    regime_id: Mapped[str | None] = mapped_column(String(32))


class OrderExecution(Base):
    """Every order the rebalancer submits, with the quotes it was priced against —
    the raw material for execution-cost analysis. All cost figures are signed so
    positive always means cost: buys filling above the reference and sells filling
    below it both count against you.

    Cost is split into implementation-shortfall components rather than reported as
    one number, because a single figure benchmarked at plan time is dominated by
    market drift between deciding and trading, not by execution:

        delay_bps      decision mid -> arrival mid   (the gap before we traded)
        execution_bps  arrival mid  -> fill          (how well we traded)

    measurement_version distinguishes the two regimes. Version 1 rows benchmarked
    everything against a one-sided ask captured at plan time and are not comparable
    with version 2; aggregates report them separately rather than mixing them."""
    __tablename__ = "order_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    shares: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(16))
    planning_price: Mapped[float | None] = mapped_column(Float)
    limit_price: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(24), default="submitted")
    filled_qty: Mapped[float | None] = mapped_column(Float)
    filled_price: Mapped[float | None] = mapped_column(Float)
    slippage_bps: Mapped[float | None] = mapped_column(Float)

    # Quote when the rebalance plan was built (the decision point)
    decision_bid: Mapped[float | None] = mapped_column(Float)
    decision_ask: Mapped[float | None] = mapped_column(Float)
    decision_mid: Mapped[float | None] = mapped_column(Float)
    # Quote immediately before the order went out (the arrival point)
    arrival_bid: Mapped[float | None] = mapped_column(Float)
    arrival_ask: Mapped[float | None] = mapped_column(Float)
    arrival_mid: Mapped[float | None] = mapped_column(Float)
    arrival_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Shortfall components, signed so positive means cost
    delay_bps: Mapped[float | None] = mapped_column(Float)
    execution_bps: Mapped[float | None] = mapped_column(Float)
    spread_bps_at_arrival: Mapped[float | None] = mapped_column(Float)
    # True when filled_price was substituted from a quote rather than reported by
    # the broker — excluded from execution aggregates
    fill_is_synthetic: Mapped[bool | None] = mapped_column(Boolean, default=False)
    measurement_version: Mapped[int | None] = mapped_column(Integer, default=2)
    # Which tape the decision/arrival quotes came from, and whether the arrival quote
    # was believable. On the free Alpaca plan quotes are IEX-only, where a mid-cap's
    # book can sit far from the consolidated NBBO — a cost figure benchmarked against
    # that mid is noise, so those rows are recorded and then excluded from aggregates.
    quote_feed: Mapped[str | None] = mapped_column(String(8))
    quote_unreliable: Mapped[bool | None] = mapped_column(Boolean, default=False)


class SystemState(Base):
    """Small key-value store for operational state that must survive
    restarts — e.g. last_rebalance_at, so a redeploy can't trigger a
    fresh rebalance the moment it boots."""
    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    side: Mapped[str] = mapped_column(String(4), default="long")
    entry_price: Mapped[float | None] = mapped_column(Float)
    exit_price: Mapped[float | None] = mapped_column(Float)
    shares: Mapped[int | None] = mapped_column(Integer)
    realized_pnl: Mapped[float | None] = mapped_column(Float)
    signal_drivers: Mapped[dict | None] = mapped_column(JSON)
    regime_at_entry: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="open")
