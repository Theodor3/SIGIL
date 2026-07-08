"""Watchlist API — manage force-included research tickers."""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db import get_db
from api.db.models import WatchlistTicker

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


class WatchlistAdd(BaseModel):
    ticker: str
    note: str | None = None


async def get_watchlist_tickers(db: AsyncSession) -> list[str]:
    """Pipeline-facing helper — always returns a list, never raises."""
    try:
        rows = await db.execute(select(WatchlistTicker.ticker))
        return sorted({r[0] for r in rows.all()})
    except Exception as e:
        print(f"[watchlist] Read failed, continuing without: {e}")
        return []


@router.get("")
async def list_watchlist(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(WatchlistTicker).order_by(WatchlistTicker.added_at.asc())
    )).scalars().all()
    return {
        "tickers": [
            {
                "ticker": r.ticker,
                "added_at": r.added_at.isoformat(),
                "note": r.note,
            }
            for r in rows
        ]
    }


@router.post("")
async def add_ticker(body: WatchlistAdd, db: AsyncSession = Depends(get_db)):
    from api.data.universe import _is_valid_ticker

    ticker = body.ticker.strip().upper()
    if not _is_valid_ticker(ticker):
        return {"error": f"'{ticker}' doesn't look like a valid US equity symbol"}

    existing = await db.get(WatchlistTicker, ticker)
    if existing:
        return {"message": f"{ticker} already on the watchlist"}

    db.add(WatchlistTicker(
        ticker=ticker,
        added_at=datetime.utcnow(),
        note=(body.note or "").strip()[:120] or None,
    ))
    await db.commit()
    return {"message": f"Added {ticker} — it joins the pipeline on the next run"}


@router.delete("/{ticker}")
async def remove_ticker(ticker: str, db: AsyncSession = Depends(get_db)):
    row = await db.get(WatchlistTicker, ticker.strip().upper())
    if not row:
        return {"error": "Not on the watchlist"}
    await db.delete(row)
    await db.commit()
    return {"message": f"Removed {ticker.strip().upper()}"}
