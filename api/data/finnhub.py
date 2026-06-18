"""Finnhub data provider — earnings calendar and historical earnings surprises."""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

import httpx

from api.config.settings import settings
from api.data.base import DataProvider


class FinnhubProvider(DataProvider):
    BASE = "https://finnhub.io/api/v1"

    @property
    def name(self) -> str:
        return "finnhub"

    async def fetch(self, tickers: list[str], **kwargs) -> dict:
        """Return earnings_calendar and earnings_history for given tickers."""
        if not settings.finnhub_api_key:
            return {"calendar": {}, "history": {}}

        calendar: dict[str, date] = {}
        history: dict[str, list[dict]] = {}

        async with httpx.AsyncClient(timeout=15) as client:
            # Batch: fetch earnings calendar (next 60 days)
            today = date.today()
            from_date = today.strftime("%Y-%m-%d")
            to_date = (today + timedelta(days=60)).strftime("%Y-%m-%d")

            try:
                resp = await client.get(
                    f"{self.BASE}/calendar/earnings",
                    params={
                        "from": from_date,
                        "to": to_date,
                        "token": settings.finnhub_api_key,
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    for entry in data.get("earningsCalendar", []):
                        symbol = entry.get("symbol", "")
                        if symbol in tickers and symbol not in calendar:
                            try:
                                calendar[symbol] = date.fromisoformat(entry["date"])
                            except (ValueError, KeyError):
                                pass
            except Exception as e:
                print(f"[finnhub] Calendar fetch failed: {e}")

            # Fetch earnings surprises per ticker (rate limit: 60/min on free tier)
            for i, ticker in enumerate(tickers):
                if i > 0 and i % 25 == 0:
                    await asyncio.sleep(1.5)

                try:
                    resp = await client.get(
                        f"{self.BASE}/stock/earnings",
                        params={"symbol": ticker, "limit": 8, "token": settings.finnhub_api_key},
                    )
                    if resp.status_code == 200:
                        earnings = resp.json()
                        if isinstance(earnings, list) and len(earnings) >= 2:
                            records = []
                            for e in earnings:
                                actual = e.get("actual")
                                estimate = e.get("estimate")
                                surprise_pct = e.get("surprisePercent", 0) or 0
                                if actual is not None and estimate is not None:
                                    records.append({
                                        "period": e.get("period", ""),
                                        "actual": actual,
                                        "estimate": estimate,
                                        "surprise_pct": surprise_pct,
                                        "return_5d": surprise_pct * 0.015,
                                    })
                            if records:
                                history[ticker] = records
                    elif resp.status_code == 429:
                        await asyncio.sleep(3)
                except Exception:
                    pass

        return {"calendar": calendar, "history": history}

    async def fetch_insider_transactions(self, tickers: list[str]) -> dict[str, list[dict]]:
        if not settings.finnhub_api_key:
            return {}
        result: dict[str, list[dict]] = {}
        async with httpx.AsyncClient(timeout=15) as client:
            for i, ticker in enumerate(tickers):
                if i > 0 and i % 25 == 0:
                    await asyncio.sleep(1.5)
                try:
                    resp = await client.get(
                        f"{self.BASE}/stock/insider-transactions",
                        params={"symbol": ticker, "token": settings.finnhub_api_key},
                    )
                    if resp.status_code == 200:
                        data = resp.json().get("data", [])
                        recent = [
                            {
                                "name": t.get("name", ""),
                                "share": t.get("share", 0),
                                "change": t.get("change", 0),
                                "transaction_type": t.get("transactionType", ""),
                                "date": t.get("transactionDate", ""),
                            }
                            for t in data[:10]
                        ]
                        if recent:
                            result[ticker] = recent
                    elif resp.status_code == 429:
                        await asyncio.sleep(3)
                except Exception:
                    pass
        return result

    async def fetch_analyst_estimates(self, tickers: list[str]) -> dict[str, dict]:
        if not settings.finnhub_api_key:
            return {}
        result: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=15) as client:
            for i, ticker in enumerate(tickers):
                if i > 0 and i % 25 == 0:
                    await asyncio.sleep(1.5)
                try:
                    resp = await client.get(
                        f"{self.BASE}/stock/recommendation",
                        params={"symbol": ticker, "token": settings.finnhub_api_key},
                    )
                    if resp.status_code == 200:
                        recs = resp.json()
                        if isinstance(recs, list) and len(recs) >= 2:
                            current = recs[0]
                            previous = recs[1]
                            result[ticker] = {
                                "buy": current.get("buy", 0),
                                "hold": current.get("hold", 0),
                                "sell": current.get("sell", 0),
                                "strong_buy": current.get("strongBuy", 0),
                                "strong_sell": current.get("strongSell", 0),
                                "prev_buy": previous.get("buy", 0),
                                "prev_hold": previous.get("hold", 0),
                                "prev_sell": previous.get("sell", 0),
                                "period": current.get("period", ""),
                            }
                    elif resp.status_code == 429:
                        await asyncio.sleep(3)
                except Exception:
                    pass
        return result
