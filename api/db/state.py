"""Persisted operational state — tiny key-value helpers over SystemState."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemState


async def get_state(db: AsyncSession, key: str) -> str | None:
    row_q = await db.execute(select(SystemState).where(SystemState.key == key))
    row = row_q.scalar_one_or_none()
    return row.value if row else None


async def set_state(db: AsyncSession, key: str, value: str) -> None:
    row_q = await db.execute(select(SystemState).where(SystemState.key == key))
    row = row_q.scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = datetime.utcnow()
    else:
        db.add(SystemState(key=key, value=value, updated_at=datetime.utcnow()))
    await db.commit()
