"""GDELT news provider — news volume and sentiment tone as alt data signal."""
from __future__ import annotations

import asyncio

import httpx

from api.data.base import DataProvider

# Override map for tickers whose symbol alone is too ambiguous for a news search
TICKER_OVERRIDES = {
    "A": "Agilent Technologies",
    "C": "Citigroup",
    "D": "Dominion Energy",
    "F": "Ford Motor",
    "K": "Kellanova cereal",
    "L": "Loews Corporation",
    "T": "AT&T",
    "V": "Visa payment",
    "Z": "Zillow",
    "ALL": "Allstate insurance",
    "ARE": "Alexandria Real Estate",
    "BAC": "Bank of America",
    "BG": "Bunge agriculture",
    "CE": "Celanese chemicals",
    "CF": "CF Industries fertilizer",
    "CL": "Colgate-Palmolive",
    "DE": "John Deere",
    "EA": "Electronic Arts",
    "EG": "Everest Group insurance",
    "ES": "Eversource Energy",
    "GE": "General Electric",
    "GIS": "General Mills",
    "GL": "Globe Life insurance",
    "GM": "General Motors",
    "HD": "Home Depot",
    "HIG": "Hartford Insurance",
    "ICE": "Intercontinental Exchange",
    "IP": "International Paper",
    "IR": "Ingersoll Rand",
    "IT": "Gartner research",
    "J": "Jacobs Solutions",
    "KEY": "KeyCorp bank",
    "KR": "Kroger grocery",
    "LW": "Lamb Weston",
    "MA": "Mastercard",
    "MO": "Altria tobacco",
    "MS": "Morgan Stanley",
    "NOW": "ServiceNow",
    "O": "Realty Income REIT",
    "ON": "ON Semiconductor",
    "PG": "Procter Gamble",
    "RE": "Everest Group reinsurance",
    "RF": "Regions Financial",
    "RL": "Ralph Lauren",
    "SQ": "Block Square fintech",
    "STE": "STERIS sterilization",
    "TT": "Trane Technologies",
    "WM": "Waste Management",
    "WY": "Weyerhaeuser timber",
    "META": "Meta Facebook",
    "GOOG": "Google Alphabet",
    "GOOGL": "Google Alphabet",
    "AAPL": "Apple iPhone",
    "AMZN": "Amazon",
    "NVDA": "Nvidia GPU",
    "TSLA": "Tesla electric",
    "NFLX": "Netflix streaming",
    "AMD": "AMD semiconductor",
    "CRM": "Salesforce",
    "PLTR": "Palantir",
    "MSFT": "Microsoft",
    "AVGO": "Broadcom semiconductor",
    "COST": "Costco",
    "JPM": "JPMorgan bank",
    "UNH": "UnitedHealth",
    "WMT": "Walmart",
    "LLY": "Eli Lilly pharma",
    "ABBV": "AbbVie pharma",
    "MRK": "Merck pharma",
    "BAC": "Bank of America",
    "INTC": "Intel semiconductor",
    "CSCO": "Cisco networking",
    "ADBE": "Adobe software",
    "QCOM": "Qualcomm chips",
    "TXN": "Texas Instruments",
    "INTU": "Intuit TurboTax",
    "AMAT": "Applied Materials semiconductor",
}


def _ticker_to_query(ticker: str, fundamentals: dict | None = None) -> str:
    """Convert a ticker to a GDELT search query string."""
    if ticker in TICKER_OVERRIDES:
        return TICKER_OVERRIDES[ticker]

    # Try company name from fundamentals
    if fundamentals:
        desc = fundamentals.get("description", "")
        if desc:
            # Extract first few words of description as company name
            name = desc.split(",")[0].split(" together")[0].split(" Inc")[0].split(" Corp")[0]
            name = name.strip()
            if len(name) > 3 and len(name) < 60:
                return name

    # For 3+ char tickers, the ticker itself is usually searchable
    if len(ticker) >= 3:
        return f"{ticker} stock"

    return ""


class GdeltProvider(DataProvider):
    BASE = "https://api.gdeltproject.org/api/v2/doc/doc"

    @property
    def name(self) -> str:
        return "gdelt"

    MAX_TICKERS = 50

    async def fetch(self, tickers: list[str], fundamentals: dict | None = None, **kwargs) -> dict:
        """Fetch news volume and avg tone for each ticker from GDELT."""
        fundamentals = fundamentals or {}
        nowcast: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=15) as client:
            queries = []
            for t in tickers:
                q = _ticker_to_query(t, fundamentals.get(t))
                if q:
                    queries.append((t, q))

            # GDELT rate-limits to 1 request per 5 seconds — cap at top N tickers
            queries = queries[:self.MAX_TICKERS]

            for i, (ticker, query) in enumerate(queries):
                if i > 0:
                    await asyncio.sleep(5.5)

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
                        if len(series) < 3:
                            continue

                        tones = [pt.get("value", 0) for pt in series]
                        volumes = [pt.get("norm", 0) for pt in series]

                        avg_tone_30d = sum(tones) / len(tones)
                        recent_n = min(7, len(tones))
                        avg_tone_7d = sum(tones[-recent_n:]) / recent_n
                        tone_shift = avg_tone_7d - avg_tone_30d

                        avg_vol_30d = sum(volumes) / len(volumes)
                        avg_vol_7d = sum(volumes[-recent_n:]) / recent_n
                        vol_ratio = avg_vol_7d / avg_vol_30d if avg_vol_30d > 0 else 1.0

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
                            "news_tone_shift": round(tone_shift, 3),
                        }
                    elif resp.status_code == 429:
                        await asyncio.sleep(5)

                except Exception:
                    pass

        return nowcast
