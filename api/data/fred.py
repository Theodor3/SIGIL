"""FRED data provider — macro indicators for regime detection."""
from __future__ import annotations

import httpx

from api.config.settings import settings
from api.data.base import DataProvider

SERIES_MAP = {
    "T10Y2Y": "yield_curve_spread",
    "BAMLH0A0HYM2": "hy_spread",
    "DTWEXBGS": "dollar_index",
    "VIXCLS": "vix_close",
}


class FredProvider(DataProvider):
    BASE = "https://api.stlouisfed.org/fred/series/observations"

    @property
    def name(self) -> str:
        return "fred"

    async def fetch(self, tickers: list[str] | None = None, **kwargs) -> dict:
        """Fetch latest values for key macro series. Returns flat dict for regime context."""
        if not settings.fred_api_key:
            return {}

        macro: dict[str, float | None] = {}

        async with httpx.AsyncClient(timeout=15) as client:
            for series_id, field_name in SERIES_MAP.items():
                try:
                    resp = await client.get(
                        self.BASE,
                        params={
                            "series_id": series_id,
                            "api_key": settings.fred_api_key,
                            "file_type": "json",
                            "sort_order": "desc",
                            "limit": 5,
                        },
                    )
                    if resp.status_code == 200:
                        observations = resp.json().get("observations", [])
                        for obs in observations:
                            val = obs.get("value", ".")
                            if val != ".":
                                macro[field_name] = float(val)
                                break
                except Exception as e:
                    print(f"[fred] Failed to fetch {series_id}: {e}")

        # Compute VIX 5d change if we have VIX
        if "vix_close" in macro:
            try:
                resp = await httpx.AsyncClient(timeout=10).get(
                    self.BASE,
                    params={
                        "series_id": "VIXCLS",
                        "api_key": settings.fred_api_key,
                        "file_type": "json",
                        "sort_order": "desc",
                        "limit": 10,
                    },
                )
                if resp.status_code == 200:
                    obs = resp.json().get("observations", [])
                    values = []
                    for o in obs:
                        v = o.get("value", ".")
                        if v != ".":
                            values.append(float(v))
                    if len(values) >= 6:
                        macro["vix_change_5d"] = round(
                            (values[0] - values[5]) / values[5], 4
                        ) if values[5] != 0 else 0
            except Exception:
                pass

        return macro
