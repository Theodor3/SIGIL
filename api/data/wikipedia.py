"""Wikipedia pageview provider — retail attention proxy via Wikimedia API."""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

import httpx

from api.data.base import DataProvider

# Map tickers to Wikipedia article titles
WIKI_MAP = {
    "AAPL": "Apple_Inc.", "MSFT": "Microsoft", "NVDA": "Nvidia", "GOOGL": "Alphabet_Inc.",
    "AMZN": "Amazon_(company)", "META": "Meta_Platforms", "TSLA": "Tesla,_Inc.",
    "AVGO": "Broadcom_Inc.", "ADBE": "Adobe_Inc.", "CRM": "Salesforce",
    "AMD": "Advanced_Micro_Devices", "NFLX": "Netflix", "INTC": "Intel",
    "ORCL": "Oracle_Corporation", "CSCO": "Cisco", "QCOM": "Qualcomm",
    "NOW": "ServiceNow", "INTU": "Intuit", "AMAT": "Applied_Materials",
    "PANW": "Palo_Alto_Networks", "SNPS": "Synopsys", "CDNS": "Cadence_Design_Systems",
    "PLTR": "Palantir_Technologies", "CRWD": "CrowdStrike", "MRVL": "Marvell_Technology",
    "SHOP": "Shopify", "SQ": "Block,_Inc.", "NET": "Cloudflare",
    "DDOG": "Datadog", "ZS": "Zscaler", "MDB": "MongoDB_Inc.",
    "SNOW": "Snowflake_Inc.", "DELL": "Dell_Technologies", "HPE": "Hewlett_Packard_Enterprise",
    "PTC": "PTC_(software_company)", "EPAM": "EPAM_Systems",
    "COIN": "Coinbase", "ROKU": "Roku", "U": "Unity_Technologies",
    "TTWO": "Take-Two_Interactive", "EA": "Electronic_Arts",
    "PAYC": "Paycom", "ADP": "Automatic_Data_Processing", "PAYX": "Paychex",
    "WDAY": "Workday,_Inc.", "VEEV": "Veeva_Systems", "HUBS": "HubSpot",
    "TTD": "The_Trade_Desk", "BILL": "Bill.com", "TWLO": "Twilio",
    "SPLK": "Splunk", "ZM": "Zoom_Video_Communications", "OKTA": "Okta",
    "V": "Visa_Inc.", "MA": "Mastercard", "JPM": "JPMorgan_Chase",
    "GS": "Goldman_Sachs", "MS": "Morgan_Stanley", "BLK": "BlackRock",
    "SCHW": "Charles_Schwab_Corporation", "ICE": "Intercontinental_Exchange",
    "CME": "CME_Group", "SPGI": "S%26P_Global",
    "UNH": "UnitedHealth_Group", "JNJ": "Johnson_%26_Johnson", "LLY": "Eli_Lilly_and_Company",
    "ABBV": "AbbVie", "TMO": "Thermo_Fisher_Scientific", "DHR": "Danaher_Corporation",
    "ABT": "Abbott_Laboratories", "ISRG": "Intuitive_Surgical",
    "LIN": "Linde_plc", "SHW": "Sherwin-Williams", "APD": "Air_Products",
    "ECL": "Ecolab", "ITW": "Illinois_Tool_Works",
    "CAT": "Caterpillar_Inc.", "DE": "John_Deere", "GE": "GE_Aerospace",
    "HON": "Honeywell", "RTX": "RTX_Corporation",
}


class WikipediaProvider(DataProvider):
    BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"

    @property
    def name(self) -> str:
        return "wikipedia"

    async def fetch(self, tickers: list[str], **kwargs) -> dict:
        """Fetch 30-day pageview data and compute attention scores."""
        today = date.today()
        end = (today - timedelta(days=1)).strftime("%Y%m%d")
        start_30d = (today - timedelta(days=31)).strftime("%Y%m%d")
        start_7d = (today - timedelta(days=8)).strftime("%Y%m%d")

        nowcast: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=10) as client:
            for i, ticker in enumerate(tickers):
                article = WIKI_MAP.get(ticker)
                if not article:
                    continue

                if i > 0 and i % 10 == 0:
                    await asyncio.sleep(1.0)

                try:
                    url = f"{self.BASE}/en.wikipedia/all-access/all-agents/{article}/daily/{start_30d}/{end}"
                    resp = await client.get(url, headers={"User-Agent": "SigilV2/1.0"})

                    if resp.status_code == 200:
                        items = resp.json().get("items", [])
                        if not items:
                            continue

                        views = [item.get("views", 0) for item in items]
                        if len(views) < 14:
                            continue

                        avg_30d = sum(views) / len(views)
                        avg_7d = sum(views[-7:]) / 7 if len(views) >= 7 else avg_30d
                        avg_prior = sum(views[:-7]) / max(len(views) - 7, 1)

                        # Attention spike: how much recent views exceed baseline
                        spike_ratio = avg_7d / avg_prior if avg_prior > 0 else 1.0
                        kpi_surprise = max(min((spike_ratio - 1.0) * 2, 1.0), -1.0)

                        # Probability outperform: higher attention -> slight bullish bias
                        prob_outperform = 0.5 + kpi_surprise * 0.15

                        nowcast[ticker] = {
                            "source_mix": "direct",
                            "kpi_surprise": round(kpi_surprise, 4),
                            "probability_outperform": round(prob_outperform, 4),
                            "confidence": round(min(avg_30d / 5000, 1.0), 3),
                            "direct_source_count": 1,
                            "proxy_source_count": 0,
                            "avg_views_30d": round(avg_30d),
                            "avg_views_7d": round(avg_7d),
                            "spike_ratio": round(spike_ratio, 3),
                        }
                    elif resp.status_code == 429:
                        await asyncio.sleep(3)

                except Exception:
                    pass

        return nowcast
