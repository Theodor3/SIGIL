"""GDELT news provider — news volume and sentiment tone as alt data signal."""
from __future__ import annotations

import asyncio

import httpx

from api.data.base import DataProvider

COMPANY_NAMES = {
    "AAPL": "Apple", "ABNB": "Airbnb", "ADBE": "Adobe", "ADI": "Analog Devices",
    "ADP": "ADP payroll", "ADSK": "Autodesk", "AMAT": "Applied Materials",
    "AMD": "AMD", "AMZN": "Amazon", "ANSS": "Ansys", "APH": "Amphenol",
    "AVGO": "Broadcom", "AXP": "American Express", "BAH": "Booz Allen",
    "BBY": "Best Buy", "BLK": "BlackRock", "BLDR": "Builders FirstSource",
    "BSX": "Boston Scientific", "CDNS": "Cadence Design", "CDW": "CDW technology",
    "CEG": "Constellation Energy", "CMG": "Chipotle", "COST": "Costco",
    "CRM": "Salesforce", "CRWD": "CrowdStrike", "CSCO": "Cisco",
    "DDOG": "Datadog", "DE": "John Deere", "DELL": "Dell",
    "DHR": "Danaher", "DXCM": "DexCom", "EA": "Electronic Arts",
    "ECL": "Ecolab", "ENPH": "Enphase Energy", "EPAM": "EPAM Systems",
    "EXPE": "Expedia", "FAST": "Fastenal", "FICO": "Fair Isaac FICO",
    "FTNT": "Fortinet", "GE": "General Electric", "GOOG": "Google",
    "GPN": "Global Payments", "GWW": "Grainger", "HLT": "Hilton Hotels",
    "HPQ": "HP Hewlett-Packard", "HUBB": "Hubbell", "IDXX": "IDEXX Labs",
    "INTU": "Intuit", "ISRG": "Intuitive Surgical", "KLAC": "KLA Corporation",
    "LRCX": "Lam Research", "MA": "Mastercard", "MELI": "MercadoLibre",
    "META": "Meta", "MNST": "Monster Beverage", "MPWR": "Monolithic Power",
    "MSFT": "Microsoft", "MSI": "Motorola Solutions", "NFLX": "Netflix",
    "NOW": "ServiceNow", "NTAP": "NetApp", "NVDA": "Nvidia",
    "ODFL": "Old Dominion Freight", "ON": "ON Semiconductor",
    "ORCL": "Oracle", "PANW": "Palo Alto Networks", "PAYC": "Paycom",
    "PH": "Parker Hannifin", "PINS": "Pinterest", "PLTR": "Palantir",
    "PTC": "PTC software", "PYPL": "PayPal", "QCOM": "Qualcomm",
    "RMD": "ResMed", "ROK": "Rockwell Automation", "SHOP": "Shopify",
    "SNPS": "Synopsys", "SQ": "Block Square", "TDG": "TransDigm",
    "TEAM": "Atlassian", "TRGP": "Targa Resources", "TSLA": "Tesla",
    "TTD": "Trade Desk", "TXN": "Texas Instruments", "UBER": "Uber",
    "V": "Visa payment", "VEEV": "Veeva Systems", "VRSK": "Verisk Analytics",
    "WSM": "Williams-Sonoma",
}


class GdeltProvider(DataProvider):
    BASE = "https://api.gdeltproject.org/api/v2/doc/doc"

    @property
    def name(self) -> str:
        return "gdelt"

    async def fetch(self, tickers: list[str], **kwargs) -> dict:
        """Fetch news volume and avg tone for each ticker from GDELT."""
        nowcast: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=15) as client:
            mapped = [(t, COMPANY_NAMES[t]) for t in tickers if t in COMPANY_NAMES]
            for i, (ticker, query) in enumerate(mapped):
                if i > 0 and i % 6 == 0:
                    await asyncio.sleep(1.5)

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
