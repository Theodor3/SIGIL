"""Universe screener — S&P 500 constituents filtered to a growth bucket."""
from __future__ import annotations

import httpx

_SP500_CSV_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"

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

GROWTH_FILTERS = {
    "min_roic": 0.05,
    "min_fcf_margin": 0.05,
    "max_debt_to_ebitda": 3.0,
}

TARGET_BUCKET_SIZE = 200


async def fetch_sp500_tickers() -> list[str]:
    """Fetch S&P 500 tickers from GitHub dataset CSV. Falls back to seed list."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(_SP500_CSV_URL)
            if resp.status_code == 200:
                lines = resp.text.strip().split("\n")
                tickers = [line.split(",")[0] for line in lines[1:] if line.strip()]
                tickers = [t for t in tickers if t.isalpha() or "." in t]
                if len(tickers) > 400:
                    return tickers
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
