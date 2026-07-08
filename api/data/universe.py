"""Universe screener — multi-index (S&P 500 + small/mid cap + ETFs) filtered to a quality bucket."""
from __future__ import annotations

import httpx

from api.config.settings import settings

_SP500_CSV_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
_FMP_BASE = "https://financialmodelingprep.com/stable"

SEED_UNIVERSE = [
    "AAPL", "ABBV", "ABT", "ACN", "ADBE", "ADI", "ADP", "ADSK", "AES", "AFL",
    "AIG", "AIZ", "ALB", "ALGN", "ALL", "AMAT", "AMCR", "AMD", "AME", "AMGN",
    "AMP", "AMZN", "ANET", "ANSS", "AON", "AOS", "APA", "APD", "APH", "APTV",
    "ARE", "ATO", "ATVI", "AVB", "AVGO", "AVY", "AWK", "AXP", "AZO", "BA",
    "BAC", "BAX", "BBWI", "BBY", "BDX", "BEN", "BF.B", "BG", "BIIB", "BIO",
    "BK", "BKNG", "BKR", "BLK", "BMY", "BR", "BRK.B", "BRO", "BSX", "BWA",
    "BXP", "C", "CAG", "CAH", "CARR", "CAT", "CB", "CBOE", "CBRE", "CCI",
    "CCL", "CDNS", "CDW", "CE", "CEG", "CF", "CFG", "CHD", "CHRW", "CHTR",
    "CI", "CINF", "CL", "CLX", "CMA", "CMCSA", "CME", "CMG", "CMI", "CMS",
    "CNC", "CNP", "COF", "COO", "COP", "COST", "CPB", "CPRT", "CPT", "CRL",
    "CRM", "CRWD", "CSCO", "CSGP", "CSX", "CTAS", "CTLT", "CTRA", "CTSH", "CTVA",
    "CVS", "CVX", "CZR", "D", "DAL", "DD", "DDOG", "DE", "DELL", "DFS",
    "DG", "DGX", "DHI", "DHR", "DIS", "DISH", "DLTR", "DOV", "DOW", "DPZ",
    "DRI", "DTE", "DUK", "DVA", "DVN", "DXC", "DXCM", "EA", "EBAY", "ECL",
    "ED", "EFX", "EIX", "EL", "EMN", "EMR", "ENPH", "EOG", "EPAM", "EQIX",
    "EQR", "EQT", "ES", "ESS", "ETN", "ETR", "ETSY", "EVRG", "EW", "EXC",
    "EXPD", "EXPE", "EXR", "F", "FANG", "FAST", "FBHS", "FCX", "FDS", "FDX",
    "FE", "FFIV", "FIS", "FISV", "FITB", "FLT", "FMC", "FOX", "FOXA", "FRC",
    "FRT", "FTNT", "FTV", "GD", "GE", "GILD", "GIS", "GL", "GLW", "GM",
    "GNRC", "GOOG", "GOOGL", "GPC", "GPN", "GRMN", "GS", "GWW", "HAL", "HAS",
    "HBAN", "HCA", "HD", "HOLX", "HON", "HPE", "HPQ", "HRL", "HSIC", "HST",
    "HSY", "HUBB", "HUM", "HWM", "IBM", "ICE", "IDXX", "IEX", "IFF", "ILMN",
    "INCY", "INTC", "INTU", "INVH", "IP", "IPG", "IQV", "IR", "IRM", "ISRG",
    "IT", "ITW", "IVZ", "J", "JBHT", "JCI", "JKHY", "JNJ", "JNPR", "JPM",
    "K", "KDP", "KEY", "KEYS", "KHC", "KIM", "KLAC", "KMB", "KMI", "KMX",
    "KO", "KR", "L", "LDOS", "LEN", "LH", "LHX", "LIN", "LKQ", "LLY",
    "LMT", "LNC", "LNT", "LOW", "LRCX", "LUMN", "LUV", "LVS", "LW", "LYB",
    "LYV", "MA", "MAA", "MAR", "MAS", "MCD", "MCHP", "MCK", "MCO", "MDLZ",
    "MDT", "MET", "META", "MGM", "MHK", "MKC", "MKTX", "MLM", "MMC", "MMM",
    "MNST", "MO", "MOH", "MOS", "MPC", "MPWR", "MRK", "MRNA", "MRO", "MS",
    "MSCI", "MSFT", "MSI", "MTB", "MTCH", "MTD", "MU", "NCLH", "NDAQ", "NDSN",
    "NEE", "NEM", "NFLX", "NI", "NKE", "NOC", "NOW", "NRG", "NSC", "NTAP",
    "NTRS", "NUE", "NVDA", "NVR", "NWL", "NWS", "NWSA", "NXPI", "O", "ODFL",
    "OGN", "OKE", "OMC", "ON", "ORCL", "ORLY", "OTIS", "OXY", "PARA", "PAYC",
    "PAYX", "PCAR", "PCG", "PEAK", "PEG", "PEP", "PFE", "PFG", "PG", "PGR",
    "PH", "PHM", "PKG", "PKI", "PLD", "PLTR", "PM", "PNC", "PNR", "PNW",
    "POOL", "PPG", "PPL", "PRU", "PSA", "PSX", "PTC", "PVH", "PWR", "PXD",
    "PYPL", "QCOM", "QRVO", "RCL", "RE", "REG", "REGN", "RF", "RHI", "RJF",
    "RL", "RMD", "ROK", "ROL", "ROP", "ROST", "RSG", "RTX", "SBAC", "SBNY",
    "SBUX", "SCHW", "SEE", "SHW", "SIVB", "SJM", "SLB", "SNA", "SNPS", "SO",
    "SPG", "SPGI", "SRE", "STE", "STT", "STX", "STZ", "SWK", "SWKS", "SYF",
    "SYK", "SYY", "T", "TAP", "TDG", "TDY", "TECH", "TEL", "TER", "TFC",
    "TFX", "TGT", "TMO", "TMUS", "TPR", "TRGP", "TRMB", "TROW", "TRV", "TSCO",
    "TSLA", "TSN", "TT", "TTWO", "TXN", "TXT", "TYL", "UAL", "UDR", "UHS",
    "ULTA", "UNH", "UNP", "UPS", "URI", "USB", "V", "VFC", "VICI", "VLO",
    "VMC", "VRSK", "VRSN", "VRTX", "VTR", "VTRS", "VZ", "WAB", "WAT", "WBA",
    "WBD", "WDC", "WEC", "WELL", "WFC", "WHR", "WM", "WMB", "WMT", "WRB",
    "WRK", "WST", "WTW", "WY", "WYNN", "XEL", "XOM", "XRAY", "XYL", "YUM",
    "ZBH", "ZBRA", "ZION", "ZTS",
]

ETF_UNIVERSE = [
    "SPY", "QQQ", "IWM", "DIA", "VTI", "VOO",
    "XLF", "XLE", "XLK", "XLV", "XLI", "XLY", "XLP", "XLU", "XLRE", "XLC", "XLB",
    "TLT", "HYG", "GLD",
]

GROWTH_FILTERS = {
    "min_roic": 0.05,
    "min_fcf_margin": 0.05,
    "max_debt_to_ebitda": 3.0,
}

TARGET_BUCKET_SIZE = 300


def _is_valid_ticker(t: str) -> bool:
    """Filter out mutual funds, warrants, and other non-equity symbols."""
    if not t or len(t) > 5:
        return False
    if len(t) == 5 and t.endswith("X"):
        return False
    return t.isalpha() or "." in t


async def _fetch_sp500() -> list[str]:
    """Fetch S&P 500 tickers from GitHub dataset CSV."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(_SP500_CSV_URL)
            if resp.status_code == 200:
                lines = resp.text.strip().split("\n")
                tickers = [line.split(",")[0] for line in lines[1:] if line.strip()]
                tickers = [t for t in tickers if _is_valid_ticker(t)]
                if len(tickers) > 400:
                    return tickers
    except Exception:
        pass
    return SEED_UNIVERSE.copy()


async def _fetch_fmp_screener(
    market_cap_min: int,
    market_cap_max: int,
    limit: int = 1500,
) -> list[str]:
    """Fetch tickers from FMP company screener by market cap range."""
    if not settings.fmp_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            params = {
                "apikey": settings.fmp_api_key,
                "marketCapMoreThan": market_cap_min,
                "marketCapLowerThan": market_cap_max,
                "exchange": "NYSE,NASDAQ",
                "limit": limit,
            }
            resp = await client.get(f"{_FMP_BASE}/company-screener", params=params)
            if resp.status_code == 200:
                data = resp.json()
                return [d["symbol"] for d in data if _is_valid_ticker(d.get("symbol", ""))]
    except Exception as e:
        print(f"[universe] FMP screener failed: {e}")
    return []


_GITHUB_LISTINGS = [
    "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nasdaq/nasdaq_full_tickers.json",
    "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main/nyse/nyse_full_tickers.json",
]

SMALL_CAP_RANGE = (300_000_000, 2_000_000_000)
MID_CAP_RANGE = (2_000_000_000, 10_000_000_000)


async def _fetch_cap_buckets() -> tuple[list[str], list[str]]:
    """Small/mid-cap tickers from the daily-updated US-Stock-Symbols GitHub
    dataset — keyless, quota-free replacement for the FMP screener (which
    silently returns nothing once the free-tier quota is spent)."""
    small: set[str] = set()
    mid: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for url in _GITHUB_LISTINGS:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue
                for row in resp.json():
                    symbol = (row.get("symbol") or "").strip()
                    if not _is_valid_ticker(symbol):
                        continue
                    try:
                        cap = float(row.get("marketCap") or 0)
                    except (TypeError, ValueError):
                        continue
                    if SMALL_CAP_RANGE[0] <= cap < SMALL_CAP_RANGE[1]:
                        small.add(symbol)
                    elif MID_CAP_RANGE[0] <= cap < MID_CAP_RANGE[1]:
                        mid.add(symbol)
    except Exception as e:
        print(f"[universe] GitHub listings fetch failed: {e}")
    return sorted(small), sorted(mid)


async def fetch_universe_tickers() -> list[str]:
    """Fetch multi-index universe: S&P 500 + small-cap + mid-cap + ETFs."""
    import asyncio

    sp500, (small_cap, mid_cap) = await asyncio.gather(
        _fetch_sp500(),
        _fetch_cap_buckets(),
    )

    # Fallback to the FMP screener only if the keyless source came up empty
    if not small_cap and not mid_cap:
        small_cap, mid_cap = await asyncio.gather(
            _fetch_fmp_screener(*SMALL_CAP_RANGE, limit=1500),
            _fetch_fmp_screener(*MID_CAP_RANGE, limit=1000),
        )

    print(f"[universe] S&P 500: {len(sp500)}, Small-cap: {len(small_cap)}, Mid-cap: {len(mid_cap)}, ETFs: {len(ETF_UNIVERSE)}")

    all_tickers = set(sp500) | set(small_cap) | set(mid_cap) | set(ETF_UNIVERSE)
    result = sorted(all_tickers)
    print(f"[universe] Total unique tickers: {len(result)}")
    return result


# Keep old name as alias for backwards compatibility in case anything imports it
fetch_sp500_tickers = fetch_universe_tickers


def screen_universe(fundamentals: dict[str, dict]) -> list[str]:
    """Apply quality filters and return up to TARGET_BUCKET_SIZE tickers."""
    scored = []
    for ticker, data in fundamentals.items():
        # ETFs auto-pass with a mid-tier quality score
        if ticker in ETF_UNIVERSE:
            scored.append((ticker, 0.5))
            continue

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
