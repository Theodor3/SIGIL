"""Additive column guard for SQLite.

Boot creates schema with Base.metadata.create_all, which creates missing *tables*
but never adds columns to a table that already exists. start.sh does try
`alembic upgrade head` first, but swallows any exception and falls back to
create_all — and the only migration on disk covers 5 of the 11 declared tables, so
most of them (order_executions among them) have never been under migration control
at all. A new column added to one of those models would therefore exist in the
model and not in the database, and every query touching it would fail at runtime.

This closes that gap: declare the columns a table needs, and any that are missing
get added. Idempotent, so it is safe to run on every boot, and additive-only —
it never drops, renames, or retypes anything.

SQLite's ALTER TABLE ADD COLUMN cannot add a NOT NULL column without a default, so
every column declared here must be nullable or carry a DEFAULT.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# table -> {column: SQL type (plus any DEFAULT clause)}
REQUIRED_COLUMNS: dict[str, dict[str, str]] = {
    "order_executions": {
        "decision_bid": "FLOAT",
        "decision_ask": "FLOAT",
        "decision_mid": "FLOAT",
        "arrival_bid": "FLOAT",
        "arrival_ask": "FLOAT",
        "arrival_mid": "FLOAT",
        "arrival_at": "DATETIME",
        "delay_bps": "FLOAT",
        "execution_bps": "FLOAT",
        "spread_bps_at_arrival": "FLOAT",
        "fill_is_synthetic": "BOOLEAN",
        # Deliberately NO SQL DEFAULT. SQLite's ALTER TABLE ADD COLUMN backfills
        # every existing row with the default, which would stamp the pre-existing
        # ask-benchmarked rows as version 2 and mix them into the corrected
        # aggregate. Left without one, they stay NULL, which the aggregator reads as
        # version 1. New rows get 2 from the model's Python-side default on insert.
        "measurement_version": "INTEGER",
        "quote_feed": "VARCHAR(8)",
        "quote_unreliable": "BOOLEAN",
    },
}


async def _existing_columns(conn: AsyncConnection, table: str) -> set[str]:
    result = await conn.execute(text(f"PRAGMA table_info({table})"))
    return {row[1] for row in result.fetchall()}


async def ensure_columns(conn: AsyncConnection) -> dict[str, list[str]]:
    """Add any declared columns that are missing. Returns what was added."""
    added: dict[str, list[str]] = {}
    for table, columns in REQUIRED_COLUMNS.items():
        present = await _existing_columns(conn, table)
        if not present:
            # Table doesn't exist yet — create_all will build it complete
            continue
        for column, sql_type in columns.items():
            if column in present:
                continue
            await conn.execute(
                text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}")
            )
            added.setdefault(table, []).append(column)
    return added
