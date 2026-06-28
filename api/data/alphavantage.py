"""Alpha Vantage data provider — earnings and company overview."""
from __future__ import annotations

import asyncio

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_BASE = "https://www.alphavantage.co/query"


class AlphaVantageProvider(DataProvider):
    @property
    def name(self) -> str:
        return "alphavantage"

    async def fetch_earnings(self, tickers: list[str]) -> dict[str, dict]:
        """Fetch earnings data. Free tier = 25 req/day, so only call for priority tickers."""
        if not settings.alpha_vantage_api_key:
            return {}

        results: dict[str, dict] = {}
        async with httpx.AsyncClient(timeout=20) as client:
            for ticker in tickers[:20]:
                try:
                    resp = await client.get(
                        _BASE,
                        params={
                            "function": "EARNINGS",
                            "symbol": ticker,
                            "apikey": settings.alpha_vantage_api_key,
                        },
                    )
                    if resp.status_code != 200:
                        continue
                    data = resp.json()
                    if "Information" in data:
                        print(f"[alphavantage] Rate limited: {data['Information']}")
                        break

                    quarterly = data.get("quarterlyEarnings", [])
                    annual = data.get("annualEarnings", [])

                    if quarterly:
                        latest = quarterly[0]
                        surprise_history = []
                        for q in quarterly[:8]:
                            estimated = q.get("estimatedEPS")
                            reported = q.get("reportedEPS")
                            if estimated and reported:
                                try:
                                    est = float(estimated)
                                    rep = float(reported)
                                    if est != 0:
                                        surprise_history.append({
                                            "date": q.get("reportedDate"),
                                            "surprise_pct": (rep - est) / abs(est),
                                            "estimated": est,
                                            "reported": rep,
                                        })
                                except (ValueError, TypeError):
                                    pass

                        results[ticker] = {
                            "latest_eps": latest.get("reportedEPS"),
                            "estimated_eps": latest.get("estimatedEPS"),
                            "surprise_pct": latest.get("surprisePercentage"),
                            "report_date": latest.get("reportedDate"),
                            "surprise_history": surprise_history,
                            "annual_earnings": [
                                {"year": a.get("fiscalDateEnding"), "eps": a.get("reportedEPS")}
                                for a in annual[:5]
                            ],
                        }
                    await asyncio.sleep(1.0)
                except Exception as e:
                    print(f"[alphavantage] {ticker} failed: {e}")

        return results

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        return await self.fetch_earnings(tickers)
