"""SEC EDGAR data provider — filing red flags.

Scans each company's recent filings for three discrete bearish events:
  - NT 10-K / NT 10-Q ("notification of late filing")
  - 8-K Item 4.01 (auditor change)
  - 8-K Item 4.02 (non-reliance on previously issued financials, i.e. restatement)

All data comes from the free data.sec.gov submissions API. Per SEC fair-access
policy we identify ourselves via User-Agent and stay well under 10 req/s.
"""
from __future__ import annotations

import asyncio
from datetime import date

import httpx

from api.data.base import DataProvider

HEADERS = {"User-Agent": "SIGIL research dashboard (theodoremaiello@gmail.com)"}
TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik:010d}.json"

NT_WINDOW_DAYS = 120
ITEM_WINDOW_DAYS = 180
CONCURRENCY = 4
REQUEST_SPACING_SECONDS = 0.5  # per worker → ~8 req/s ceiling across 4 workers

# ticker -> CIK, loaded once per process (the mapping file is ~1MB and stable)
_cik_cache: dict[str, int] = {}


class EdgarProvider(DataProvider):
    @property
    def name(self) -> str:
        return "edgar"

    async def _load_cik_map(self, client: httpx.AsyncClient) -> dict[str, int]:
        global _cik_cache
        if _cik_cache:
            return _cik_cache
        resp = await client.get(TICKER_MAP_URL)
        resp.raise_for_status()
        data = resp.json()
        _cik_cache = {
            str(row["ticker"]).upper(): int(row["cik_str"])
            for row in data.values()
            if row.get("ticker") and row.get("cik_str")
        }
        return _cik_cache

    @staticmethod
    def _scan_filings(recent: dict, today: date) -> dict:
        """Extract red-flag events from a submissions 'recent' block."""
        forms = recent.get("form", []) or []
        dates = recent.get("filingDate", []) or []
        items = recent.get("items", []) or []

        flags = {"nt_filings": [], "auditor_changes": [], "restatements": []}
        for i, form in enumerate(forms):
            if i >= len(dates):
                break
            try:
                filed = date.fromisoformat(dates[i])
            except (ValueError, TypeError):
                continue
            age_days = (today - filed).days

            if form.startswith("NT ") and age_days <= NT_WINDOW_DAYS:
                flags["nt_filings"].append({"form": form, "date": dates[i]})
            elif form.startswith("8-K") and age_days <= ITEM_WINDOW_DAYS:
                filing_items = items[i] if i < len(items) else ""
                if not filing_items:
                    continue
                if "4.02" in filing_items:
                    flags["restatements"].append({"form": form, "date": dates[i]})
                elif "4.01" in filing_items:
                    flags["auditor_changes"].append({"form": form, "date": dates[i]})
        return flags

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        """Return {ticker: {nt_filings, auditor_changes, restatements}} for
        every ticker that was successfully checked (empty lists = clean)."""
        results: dict[str, dict] = {}
        today = date.today()
        sem = asyncio.Semaphore(CONCURRENCY)

        async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
            try:
                cik_map = await self._load_cik_map(client)
            except Exception as e:
                print(f"[edgar] CIK map load failed: {e}")
                return {}

            async def fetch_one(ticker: str) -> None:
                cik = cik_map.get(ticker.upper())
                if cik is None:
                    return
                async with sem:
                    try:
                        resp = await client.get(SUBMISSIONS_URL.format(cik=cik))
                        if resp.status_code == 200:
                            recent = resp.json().get("filings", {}).get("recent", {})
                            results[ticker] = self._scan_filings(recent, today)
                    except Exception:
                        pass
                    await asyncio.sleep(REQUEST_SPACING_SECONDS)

            await asyncio.gather(*(fetch_one(t) for t in tickers))

        flagged = sum(1 for f in results.values() if any(f.values()))
        print(f"[edgar] Checked {len(results)}/{len(tickers)} tickers, {flagged} with red flags")
        return results
