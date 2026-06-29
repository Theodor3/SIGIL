"""Wikipedia pageview provider — retail attention proxy via Wikimedia API."""
from __future__ import annotations

import asyncio
from datetime import date, timedelta

import httpx

from api.data.base import DataProvider

# Map tickers to Wikipedia article titles for tickers where the article name
# isn't just the company name with spaces replaced by underscores
WIKI_OVERRIDES = {
    "AAPL": "Apple_Inc.", "GOOGL": "Alphabet_Inc.", "GOOG": "Alphabet_Inc.",
    "AMZN": "Amazon_(company)", "META": "Meta_Platforms", "TSLA": "Tesla,_Inc.",
    "AVGO": "Broadcom_Inc.", "AMD": "Advanced_Micro_Devices",
    "BRK.B": "Berkshire_Hathaway", "V": "Visa_Inc.", "MA": "Mastercard",
    "JPM": "JPMorgan_Chase", "BAC": "Bank_of_America",
    "JNJ": "Johnson_%26_Johnson", "UNH": "UnitedHealth_Group",
    "LLY": "Eli_Lilly_and_Company", "ABBV": "AbbVie",
    "TMO": "Thermo_Fisher_Scientific", "DHR": "Danaher_Corporation",
    "ABT": "Abbott_Laboratories", "ISRG": "Intuitive_Surgical",
    "SQ": "Block,_Inc.", "SPGI": "S%26P_Global",
    "DE": "John_Deere", "GE": "GE_Aerospace", "RTX": "RTX_Corporation",
    "CAT": "Caterpillar_Inc.", "HON": "Honeywell", "BA": "Boeing",
    "F": "Ford_Motor_Company", "GM": "General_Motors",
    "HD": "The_Home_Depot", "WMT": "Walmart", "COST": "Costco",
    "KO": "The_Coca-Cola_Company", "PEP": "PepsiCo", "MCD": "McDonald%27s",
    "DIS": "The_Walt_Disney_Company", "NFLX": "Netflix",
    "CRM": "Salesforce", "ORCL": "Oracle_Corporation",
    "CSCO": "Cisco", "INTC": "Intel", "QCOM": "Qualcomm",
    "T": "AT%26T", "VZ": "Verizon_Communications", "TMUS": "T-Mobile_US",
    "XOM": "ExxonMobil", "CVX": "Chevron_Corporation",
    "PFE": "Pfizer", "MRK": "Merck_%26_Co.", "MRNA": "Moderna",
    "GS": "Goldman_Sachs", "MS": "Morgan_Stanley",
    "C": "Citigroup", "WFC": "Wells_Fargo",
    "PLTR": "Palantir_Technologies", "CRWD": "CrowdStrike",
    "COIN": "Coinbase", "ROKU": "Roku",
    "ZM": "Zoom_Video_Communications", "PYPL": "PayPal",
    "SHW": "Sherwin-Williams", "LIN": "Linde_plc",
    "NOW": "ServiceNow", "SNOW": "Snowflake_Inc.",
    "PANW": "Palo_Alto_Networks", "DDOG": "Datadog",
    "DELL": "Dell_Technologies", "HPQ": "Hewlett-Packard",
    "PG": "Procter_%26_Gamble", "CL": "Colgate-Palmolive",
    "ALL": "The_Allstate_Corporation",
}


def _ticker_to_article(ticker: str, fundamentals: dict | None = None) -> str | None:
    """Convert a ticker to a Wikipedia article title."""
    if ticker in WIKI_OVERRIDES:
        return WIKI_OVERRIDES[ticker]

    # Try building from company description
    if fundamentals:
        desc = fundamentals.get("description", "")
        if desc:
            # Extract company name from description start
            name = desc.split(",")[0].split(" together")[0].strip()
            name = name.replace(" Inc.", "").replace(" Corp.", "").replace(" Ltd.", "")
            name = name.replace(" plc", "").replace(" Co.", "").strip()
            if len(name) > 3 and len(name) < 50:
                return name.replace(" ", "_")

    return None


class WikipediaProvider(DataProvider):
    BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"
    MAX_TICKERS = 80

    @property
    def name(self) -> str:
        return "wikipedia"

    async def fetch(self, tickers: list[str], fundamentals: dict | None = None, **kwargs) -> dict:
        """Fetch 30-day pageview data and compute attention scores."""
        fundamentals = fundamentals or {}
        today = date.today()
        end = (today - timedelta(days=1)).strftime("%Y%m%d")
        start_30d = (today - timedelta(days=31)).strftime("%Y%m%d")

        nowcast: dict[str, dict] = {}

        async with httpx.AsyncClient(timeout=10) as client:
            queries = []
            for t in tickers:
                article = _ticker_to_article(t, fundamentals.get(t))
                if article:
                    queries.append((t, article))

            queries = queries[:self.MAX_TICKERS]

            for i, (ticker, article) in enumerate(queries):
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
                        if len(views) < 7:
                            continue

                        avg_30d = sum(views) / len(views)
                        avg_7d = sum(views[-7:]) / 7
                        avg_prior = sum(views[:-7]) / max(len(views) - 7, 1)

                        spike_ratio = avg_7d / avg_prior if avg_prior > 0 else 1.0
                        kpi_surprise = max(min((spike_ratio - 1.0) * 2, 1.0), -1.0)
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
                            "deviation": round(kpi_surprise * 0.3, 4),
                        }
                    elif resp.status_code == 429:
                        await asyncio.sleep(3)

                except Exception:
                    pass

        return nowcast
