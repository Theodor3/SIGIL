"""Universe screener — filters S&P 500 to a growth bucket."""
from __future__ import annotations

import httpx

# Hardcoded S&P 500 growth-oriented subset for Phase 2
# Full S&P 500 scraping from Wikipedia will be added later
SEED_UNIVERSE = [
    "AAPL", "ABNB", "ADBE", "ADI", "ADP", "ADSK", "AMAT", "AMD", "AMZN", "ANSS",
    "APH", "AVGO", "AXP", "BAH", "BBY", "BILL", "BLK", "BLDR", "BR", "BSX",
    "CDNS", "CDW", "CEG", "CMG", "COST", "CRM", "CRWD", "CSGP", "CSCO", "DDOG",
    "DE", "DELL", "DG", "DHR", "DXCM", "EA", "ECL", "ENPH", "EPAM", "EXPE",
    "FAST", "FICO", "FIX", "FTNT", "GE", "GOOG", "GPN", "GWW", "HLT", "HPQ",
    "HUBB", "HWM", "IDXX", "INTU", "ISRG", "IT", "KLAC", "LRCX", "MA", "MELI",
    "META", "MNST", "MPWR", "MSFT", "MSI", "MTD", "MTX", "NFLX", "NOW", "NTAP",
    "NVDA", "ODFL", "ON", "ORCL", "PANW", "PAYC", "PH", "PINS", "PLTR", "PTC",
    "PYPL", "QCOM", "RMD", "ROK", "ROL", "SHOP", "SNPS", "SQ", "STE", "TDG",
    "TEAM", "TRGP", "TSLA", "TTD", "TXN", "UBER", "V", "VEEV", "VRSK", "WSM",
]

GROWTH_FILTERS = {
    "min_roic": 0.05,
    "min_fcf_margin": 0.05,
    "max_debt_to_ebitda": 3.0,
}

TARGET_BUCKET_SIZE = 75


async def fetch_sp500_tickers() -> list[str]:
    """Fetch S&P 500 tickers from Wikipedia. Falls back to seed list."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if resp.status_code == 200:
                import re
                # Extract tickers from the Wikipedia table
                matches = re.findall(
                    r'<td[^>]*><a[^>]*>([A-Z]{1,5})</a></td>',
                    resp.text,
                )
                if len(matches) > 100:
                    return matches
    except Exception:
        pass
    return SEED_UNIVERSE.copy()


def screen_universe(fundamentals: dict[str, dict]) -> list[str]:
    """Apply growth filters and return up to TARGET_BUCKET_SIZE tickers."""
    scored = []
    for ticker, data in fundamentals.items():
        roic = data.get("roic", 0) or 0
        fcf_margin = data.get("fcf_margin", 0) or 0
        debt_ebitda = data.get("debt_to_ebitda")

        if debt_ebitda is not None and debt_ebitda > GROWTH_FILTERS["max_debt_to_ebitda"]:
            continue

        quality = (
            min(roic, 1.0) +
            min(fcf_margin, 0.75) +
            min(data.get("asset_turnover", 0) or 0, 1.5) / 1.5
        ) / 3.0

        scored.append((ticker, quality))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [t for t, _ in scored[:TARGET_BUCKET_SIZE]]
