"""SEC EDGAR buyback-authorization scanner — no LLM, pure filings.

Finds board-authorized share repurchase programs via EDGAR full-text
search over recent 8-Ks, then fetches each hit's primary document and
regex-confirms an authorization event (authorize/approve language near
"repurchase") and extracts the dollar amount when stated.

This is deliberately distinct from executed buybacks (buyback_yield reads
the trailing cash-flow statement): an authorization is forward-looking —
management signaling with committed capital before a dollar is spent.
"""
from __future__ import annotations

import asyncio
import re
from datetime import date, timedelta

import httpx

from api.data.base import DataProvider

HEADERS = {"User-Agent": "SIGIL research dashboard (theodoremaiello@gmail.com)"}
TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
FTS_URL = "https://efts.sec.gov/LATEST/search-index"
DOC_URL = "https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/{filename}"

LOOKBACK_DAYS = 200
CONCURRENCY = 4
REQUEST_SPACING_SECONDS = 0.35  # ~8 req/s ceiling with 4 workers, SEC-polite

# Authorization event: authorize/approve verbs within a sentence of
# "repurchase" (either ordering). A bare mention in an earnings release
# does not match.
_AUTH_PATTERNS = [
    re.compile(r"(?:authoriz|approv)[a-z]*[^.]{0,240}?repurchase", re.IGNORECASE),
    re.compile(r"repurchase\s+program[^.]{0,160}?(?:authoriz|approv)", re.IGNORECASE),
    re.compile(r"(?:new|additional|increased)[^.]{0,80}?repurchase\s+(?:program|authorization)", re.IGNORECASE),
]

# Dollar amounts like "$1.5 billion", "$500 million", "$25,000,000"
_AMOUNT_RE = re.compile(
    r"\$\s*([\d][\d,]*(?:\.\d+)?)\s*(billion|million)?", re.IGNORECASE
)
_TAG_RE = re.compile(r"<[^>]+>")

_cik_cache: dict[str, int] = {}


def _extract_authorization(text: str) -> tuple[bool, float | None]:
    """Return (is_authorization_event, authorized_usd_or_None)."""
    plain = _TAG_RE.sub(" ", text)
    matched_spans = []
    for pat in _AUTH_PATTERNS:
        for m in pat.finditer(plain):
            matched_spans.append((max(0, m.start() - 300), min(len(plain), m.end() + 300)))
    if not matched_spans:
        return False, None

    # Largest dollar figure near any authorization sentence — programs are
    # typically the biggest number in their own vicinity
    best: float | None = None
    for start, end in matched_spans:
        window = plain[start:end]
        for m in _AMOUNT_RE.finditer(window):
            try:
                value = float(m.group(1).replace(",", ""))
            except ValueError:
                continue
            unit = (m.group(2) or "").lower()
            if unit == "billion":
                value *= 1e9
            elif unit == "million":
                value *= 1e6
            elif value < 1e6:
                # A bare "$50" style figure — per-share price, not a program
                continue
            if best is None or value > best:
                best = value
    return True, best


class BuybackProvider(DataProvider):
    @property
    def name(self) -> str:
        return "buybacks"

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

    async def fetch(self, tickers: list[str], **kwargs) -> dict[str, dict]:
        """Return {ticker: {authorized_usd, announced, amount_known, form}}
        for tickers with a confirmed authorization in the lookback window."""
        results: dict[str, dict] = {}
        since = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
        sem = asyncio.Semaphore(CONCURRENCY)

        async with httpx.AsyncClient(timeout=25, headers=HEADERS) as client:
            try:
                cik_map = await self._load_cik_map(client)
            except Exception as e:
                print(f"[buybacks] CIK map load failed: {e}")
                return {}

            async def fetch_one(ticker: str) -> None:
                cik = cik_map.get(ticker.upper())
                if cik is None:
                    return
                async with sem:
                    try:
                        fts = await client.get(FTS_URL, params={
                            "q": '"repurchase program"',
                            "forms": "8-K",
                            "ciks": f"{cik:010d}",
                            "startdt": since,
                            "enddt": date.today().isoformat(),
                        })
                        await asyncio.sleep(REQUEST_SPACING_SECONDS)
                        if fts.status_code != 200:
                            return
                        hits = (fts.json().get("hits", {}) or {}).get("hits", [])
                        if not hits:
                            return

                        # Newest hit first; check up to 3 filings for a
                        # confirmed authorization event
                        def _filed(h):
                            return (h.get("_source", {}) or {}).get("file_date", "")
                        for hit in sorted(hits, key=_filed, reverse=True)[:3]:
                            src = hit.get("_source", {}) or {}
                            raw_id = hit.get("_id", "")  # "accession:filename"
                            if ":" not in raw_id:
                                continue
                            accession, filename = raw_id.split(":", 1)
                            doc = await client.get(DOC_URL.format(
                                cik=cik,
                                accession=accession.replace("-", ""),
                                filename=filename,
                            ))
                            await asyncio.sleep(REQUEST_SPACING_SECONDS)
                            if doc.status_code != 200:
                                continue
                            is_auth, usd = _extract_authorization(doc.text[:400_000])
                            if not is_auth:
                                continue
                            results[ticker] = {
                                "authorized_usd": usd,
                                "amount_known": usd is not None,
                                "announced": src.get("file_date"),
                                "form": src.get("file_type", "8-K"),
                            }
                            return
                    except Exception:
                        pass

            await asyncio.gather(*(fetch_one(t) for t in tickers))

        with_amount = sum(1 for r in results.values() if r["amount_known"])
        print(f"[buybacks] {len(results)}/{len(tickers)} tickers with authorizations "
              f"({with_amount} with parsed amounts)")
        return results
