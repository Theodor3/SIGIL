"""initial schema

Revision ID: 5b25e986d11e
Revises:
Create Date: 2026-06-17 11:50:50.125647
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5b25e986d11e"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "pipeline_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("started_at", sa.DateTime, nullable=False),
        sa.Column("finished_at", sa.DateTime),
        sa.Column("regime_id", sa.String(32)),
        sa.Column("regime_confidence", sa.Float),
        sa.Column("universe_size", sa.Integer),
        sa.Column("status", sa.String(16), server_default="running"),
        sa.Column("error_message", sa.Text),
    )

    op.create_table(
        "signal_predictions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("pipeline_runs.id"), nullable=False),
        sa.Column("run_date", sa.Date, nullable=False),
        sa.Column("signal_name", sa.String(64), nullable=False),
        sa.Column("signal_version", sa.String(16)),
        sa.Column("ticker", sa.String(10), nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("confidence", sa.Float, nullable=False),
        sa.Column("metadata", sa.JSON),
        sa.UniqueConstraint("run_id", "signal_name", "ticker"),
    )

    op.create_table(
        "signal_evaluations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("prediction_id", sa.Integer, sa.ForeignKey("signal_predictions.id"), nullable=False),
        sa.Column("horizon_days", sa.Integer, nullable=False),
        sa.Column("actual_return", sa.Float),
        sa.Column("signal_correct", sa.Boolean),
        sa.Column("alpha_vs_benchmark", sa.Float),
        sa.Column("evaluated_at", sa.DateTime),
        sa.UniqueConstraint("prediction_id", "horizon_days"),
    )

    op.create_table(
        "regime_history",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("as_of_date", sa.Date, nullable=False, unique=True),
        sa.Column("regime_id", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Float),
        sa.Column("spy_20d_return", sa.Float),
        sa.Column("vix_level", sa.Float),
        sa.Column("breadth_state", sa.String(32)),
        sa.Column("metadata", sa.JSON),
    )

    op.create_table(
        "trades",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("opened_at", sa.DateTime, nullable=False),
        sa.Column("closed_at", sa.DateTime),
        sa.Column("ticker", sa.String(10), nullable=False),
        sa.Column("side", sa.String(4), server_default="long"),
        sa.Column("entry_price", sa.Float),
        sa.Column("exit_price", sa.Float),
        sa.Column("shares", sa.Integer),
        sa.Column("realized_pnl", sa.Float),
        sa.Column("signal_drivers", sa.JSON),
        sa.Column("regime_at_entry", sa.String(32)),
        sa.Column("status", sa.String(16), server_default="open"),
    )


def downgrade() -> None:
    op.drop_table("trades")
    op.drop_table("regime_history")
    op.drop_table("signal_evaluations")
    op.drop_table("signal_predictions")
    op.drop_table("pipeline_runs")
