"""GDELT news provider — news volume and sentiment tone as alt data signal."""
from __future__ import annotations

import asyncio

import httpx

from api.data.base import DataProvider

COMPANY_NAMES = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "Nvidia", "GOOGL": "Google",
    "AMZN": "Amazon", "META": "Meta", "TSLA": "Tesla", "AVGO": "Broadcom",
    "ADBE": "Adobe", "CRM": "Salesforce", "AMD": "AMD", "NFLX": "Netflix",
    "INTC": "Intel", "ORCL": "Oracle", "CSCO": "Cisco", "QCOM": "Qualcomm",
    "NOW": "ServiceNow", "INTU": "Intuit", "PANW": "Palo Alto Networks",
    "PLTR": "Palantir", "CRWD": "CrowdStrike", "SHOP": "Shopify",
    "SQ": "Block Square", "NET": "Cloudflare", "DDOG": "Datadog",
    "SNOW": "Snowflake", "DELL": "Dell", "COIN": "Coinbase",
    "ROKU": "Roku", "EA": "Electronic Arts", "PAYC": "Paycom",
    "ADP": "ADP payroll", "WDAY": "Workday", "TTD": "Trade Desk",
    "ZM": "Zoom Video", "OKTA": "Okta identity",
    "V": "Visa payment", "MA": "Mastercard", "JPM": "JPMorgan",
    "GS": "Goldman Sachs", "MS": "Morgan Stanley", "BLK": "BlackRock",
    "UNH": "UnitedHealth", "JNJ": "Johnson Johnson", "LLY": "Eli Lilly",
    "ABBV": "AbbVie", "TMO": "Thermo Fisher", "ABT": "Abbott Labs",
    "CAT": "Caterpillar", "DE": "John Deere", "HON": "Honeywell",
}


class GdeltProvider(DataProvider):
    BASE = "https://api.gdeltproject.org/api/v2/doc/doc"

    @property
    def name(self) -> str:
        return "gdelt"

    async def fetch(self, tickers: list[str], **kwargs) -> dict:
        """Fetch news volume and avg tone for each ticker from GDELT."""
        nowcast: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=12) as client:
            for i, ticker in enumerate(tickers):
                query = COMPANY_NAMES.get(ticker)
                if not query:
                    continue

                if i > 0 and i % 8 == 0:
                    await asyncio.sleep(2.0)

                try:
                    resp = await client.get(
                        self.BASE,
                        params={
                            "query": f'"{query}"',
                            "mode": "timelinetone",
                            "timespan": "30d",
                            "format": "json",
                        },
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        timeline = data.get("timeline", [])
                        if not timeline:
                            continue

                        series = timeline[0].get("data", []) if timeline else []
                        if len(series) < 7:
                            continue

                        tones = [pt.get("value", 0) for pt in series]
                        volumes = [pt.get("norm", 0) for pt in series]

                        avg_tone_30d = sum(tones) / len(tones)
                        avg_tone_7d = sum(tones[-7:]) / 7
                        tone_shift = avg_tone_7d - avg_tone_30d

                        avg_vol_30d = sum(volumes) / len(volumes)
                        avg_vol_7d = sum(volumes[-7:]) / 7
                        vol_ratio = avg_vol_7d / avg_vol_30d if avg_vol_30d > 0 else 1.0

                        # Positive tone shift + volume spike = bullish signal
                        sentiment_score = max(min(tone_shift / 3.0, 1.0), -1.0)
                        volume_signal = max(min((vol_ratio - 1.0) * 1.5, 0.5), -0.5)

                        deviation = round((sentiment_score + volume_signal) / 2, 4)
                        prob = 0.5 + deviation * 0.2

                        nowcast[ticker] = {
                            "source_mix": "proxy_only",
                            "kpi_surprise": round(sentiment_score, 4),
                            "deviation": deviation,
                            "probability_outperform": round(prob, 4),
                            "confidence": round(min(avg_vol_30d / 100, 0.8), 3),
                            "direct_source_count": 0,
                            "proxy_source_count": 1,
                            "avg_tone_30d": round(avg_tone_30d, 3),
                            "avg_tone_7d": round(avg_tone_7d, 3),
                            "tone_shift": round(tone_shift, 3),
                            "volume_ratio": round(vol_ratio, 3),
                        }
                    elif resp.status_code == 429:
                        await asyncio.sleep(5)

                except Exception:
                    pass

        return nowcast
