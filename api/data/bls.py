"""Bureau of Labor Statistics provider — CPI, employment, payrolls, PPI."""
from __future__ import annotations

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

SERIES_MAP = {
    "CUUR0000SA0": "cpi_all_urban",
    "CES0000000001": "nonfarm_payrolls",
    "LNS14000000": "unemployment_rate_bls",
    "CUUR0000SA0L1E": "core_cpi",
    "WPUFD49104": "ppi_final_demand",
    "CES0500000003": "avg_hourly_earnings",
}


class BLSProvider(DataProvider):
    @property
    def name(self) -> str:
        return "bls"

    async def fetch(self, tickers: list[str] | None = None, **kwargs) -> dict[str, float | None]:
        if not settings.bls_api_key:
            return {}

        macro: dict[str, float | None] = {}
        series_ids = list(SERIES_MAP.keys())

        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    _BASE,
                    json={
                        "seriesid": series_ids,
                        "startyear": str(__import__("datetime").date.today().year - 1),
                        "endyear": str(__import__("datetime").date.today().year),
                        "registrationkey": settings.bls_api_key,
                    },
                )
                if resp.status_code != 200:
                    print(f"[bls] HTTP {resp.status_code}")
                    return {}

                data = resp.json()
                if data.get("status") != "REQUEST_SUCCEEDED":
                    print(f"[bls] API error: {data.get('message', [])}")
                    return {}

                for series in data.get("Results", {}).get("series", []):
                    series_id = series.get("seriesID", "")
                    field_name = SERIES_MAP.get(series_id)
                    if not field_name:
                        continue
                    observations = series.get("data", [])
                    if observations:
                        latest = observations[0]
                        try:
                            macro[field_name] = float(latest["value"])
                        except (ValueError, KeyError):
                            pass
                        if len(observations) >= 13:
                            try:
                                current = float(observations[0]["value"])
                                year_ago = float(observations[12]["value"])
                                if year_ago != 0:
                                    macro[f"{field_name}_yoy"] = round(
                                        (current - year_ago) / year_ago, 4
                                    )
                            except (ValueError, KeyError, IndexError):
                                pass
        except Exception as e:
            print(f"[bls] fetch failed: {e}")

        return macro
