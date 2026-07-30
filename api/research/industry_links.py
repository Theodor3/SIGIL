"""Crosswalk from vendor industry labels to economically linked industry groups.

Groundwork for a cross-predictability signal. Menzly & Ozbas (2010, JF) show that
supplier and customer industries predict each other's returns, because value-relevant
information diffuses slowly across economic links when investors specialise by
industry. Their weights come from BEA input-output tables. Cohen & Frazzini (2008)
find the same effect at firm level, worth ~1.45%/month, but firm-level links are not
usable here: ASC 280 requires a company to disclose that it has a >10%-of-revenue
customer and the amount, and explicitly does NOT require the customer's identity.
Industry level sidesteps that entirely -- BEA publishes the full matrix.

Why this belongs in SIGIL specifically: every price-based signal in the book is
negative at 20d (technical_breakout -1.54%, alt_momentum -0.96%, peer_relative
-0.64%, momentum_decay barely positive), so own-firm price history does not predict.
This is a *different* industry's return predicting yours through information transfer,
not trend-following on the name itself. Menzly & Ozbas also find the effect shrinks
with analyst coverage and institutional ownership, which points it squarely at the
thinly-covered small and mid caps this universe holds.

Three layers, deliberately separated so each can be validated on its own:

  vendor industry label   (~145 Morningstar-style strings from FMP)
        |  INDUSTRY_TO_GROUP
  link group              (~40 groups: coarse enough to have a liquid ETF proxy,
        |                   fine enough to preserve real I-O structure)
        |  LinkGroup.bea_codes / LinkGroup.etf
  BEA Summary industries + an ETF used as the group's return proxy

The predictor side has to come from ETFs rather than the 260-name universe: spread
over ~145 industries that is under two names per industry, far too thin to compute an
industry return. The predicted side is the universe itself.

Known limitation worth stating plainly: collapsing BEA Summary (~71 industries) onto
~40 ETF-proxied groups discards real granularity, and a chunk of the published effect
probably lives in what gets discarded. Treat the direction as evidence-backed and the
magnitude as unknown.

Second limitation: this is only as good as the vendor's industry label. IDCC is
tagged "Software - Application" when InterDigital is a wireless patent licensor whose
cash flows come from handset makers. Mislabels do not merely add noise here -- they
wire a name into the wrong supply chain. MISCLASSIFIED_OVERRIDES exists for cases
worth correcting by hand.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class LinkGroup:
    """One node in the industry link graph.

    bea_codes are BEA Summary-level industry codes whose input-output rows and columns
    aggregate into this group. They are asserted here, NOT trusted: bea_io.load()
    validates every code against the table actually supplied and reports anything it
    cannot find, so a wrong code surfaces as a loud mismatch instead of silently
    contributing zero weight.

    etf is the return proxy for the group. Liquidity matters more than precision --
    a thin ETF produces a noisy predictor, which defeats the purpose.
    """
    key: str
    label: str
    bea_codes: tuple[str, ...]
    etf: str
    notes: str = ""


# ~40 groups. Granularity is spent where input-output structure actually differs:
# semis vs software, upstream energy vs midstream, banks vs asset managers.
LINK_GROUPS: tuple[LinkGroup, ...] = (
    # --- Technology
    LinkGroup("semis", "Semiconductors & equipment", ("334",), "SMH"),
    LinkGroup("software", "Software & internet", ("511", "514"), "IGV"),
    LinkGroup("it_services", "IT services & systems design", ("5415",), "XLK"),
    LinkGroup("hardware", "Computer & communications hardware", ("334", "335"), "XLK"),
    LinkGroup("electronics_dist", "Electronics distribution", ("42",), "XLK",
              "Wholesale trade row; distribution economics track the goods they move"),
    # --- Communication services
    LinkGroup("telecom", "Telecom services", ("513",), "IYZ"),
    LinkGroup("media", "Media & entertainment", ("512", "711AS"), "XLC"),
    # --- Healthcare
    LinkGroup("biotech", "Biotechnology", ("325",), "XBI",
              "BEA folds pharma/bio into chemical products"),
    LinkGroup("pharma", "Pharmaceuticals", ("325",), "XPH"),
    LinkGroup("med_devices", "Medical devices & supplies", ("339",), "IHI"),
    # 622HO appears in some BEA vintages; the current Summary table splits hospitals
    # (622) from nursing and residential care (623). Caught by load()'s code validation.
    LinkGroup("providers", "Healthcare providers & services",
              ("621", "622", "623", "624"), "IHF"),
    LinkGroup("health_it", "Health information services", ("5415", "514"), "IHF"),
    # --- Financials
    LinkGroup("banks", "Banks", ("521CI",), "KRE"),
    LinkGroup("asset_mgmt", "Asset management & brokers", ("523", "525"), "IAI"),
    LinkGroup("insurance", "Insurance", ("524",), "KIE"),
    LinkGroup("cap_markets_re", "Real estate & REITs", ("HS", "ORE"), "XLRE"),
    # --- Energy
    LinkGroup("oil_gas_ep", "Oil & gas exploration & production", ("211",), "XOP"),
    LinkGroup("oil_services", "Oil & gas equipment & services", ("213",), "OIH"),
    LinkGroup("midstream", "Midstream & pipelines", ("486",), "AMLP"),
    LinkGroup("refining", "Refining & petroleum products", ("324",), "XLE"),
    LinkGroup("coal", "Coal & consumable fuels", ("212",), "XLE"),
    LinkGroup("utilities", "Utilities", ("22",), "XLU"),
    # --- Industrials
    LinkGroup("machinery", "Machinery & industrial equipment", ("333",), "XLI"),
    LinkGroup("aerospace_defense", "Aerospace & defence", ("3364OT",), "ITA"),
    LinkGroup("transport", "Transportation & logistics", ("482", "484", "493", "487OS"), "IYT"),
    LinkGroup("airlines", "Airlines", ("481",), "IYT"),
    LinkGroup("construction", "Construction & engineering", ("23",), "ITB"),
    LinkGroup("building_products", "Building products", ("321", "327", "332"), "ITB"),
    LinkGroup("business_services", "Commercial & staffing services", ("561", "5412OP", "55"), "XLI"),
    LinkGroup("waste", "Waste management", ("562",), "XLI"),
    LinkGroup("electrical_equip", "Electrical equipment", ("335",), "XLI"),
    # --- Materials
    LinkGroup("chemicals", "Chemicals", ("325",), "XLB"),
    LinkGroup("metals_mining", "Metals & mining", ("212", "331"), "XME"),
    LinkGroup("gold", "Gold & precious metals", ("212",), "GDX"),
    LinkGroup("paper_packaging", "Paper & packaging", ("322", "326"), "XLB"),
    # --- Consumer cyclical
    LinkGroup("autos", "Autos & parts", ("3361MV",), "XLY"),
    LinkGroup("retail_discretionary", "Discretionary retail", ("4A0", "452", "441"), "XRT"),
    LinkGroup("apparel", "Apparel, footwear & textiles", ("315AL", "313TT"), "XRT"),
    LinkGroup("restaurants_travel", "Restaurants, travel & leisure",
              ("722", "721", "713"), "XLY"),
    LinkGroup("homebuilding", "Homebuilding & furnishings", ("337", "23"), "ITB"),
    # --- Consumer defensive
    LinkGroup("food_beverage", "Food, beverage & tobacco", ("311FT",), "XLP"),
    LinkGroup("agriculture", "Agriculture & farm products", ("111CA", "113FF"), "MOO"),
    LinkGroup("staples_retail", "Staples retail & distribution", ("445",), "XLP"),
    LinkGroup("household_products", "Household & personal products", ("325", "339"), "XLP"),
)

GROUPS_BY_KEY: dict[str, LinkGroup] = {g.key: g for g in LINK_GROUPS}


# Vendor industry label -> link group key.
#
# Keys are FMP/Morningstar industry strings, matched case-insensitively with dash and
# whitespace normalised (see normalise_industry), because the vendor is inconsistent
# about "Banks - Regional" vs "Banks—Regional" vs "Banks Regional".
INDUSTRY_TO_GROUP: dict[str, str] = {
    # Technology
    "semiconductors": "semis",
    "semiconductor equipment & materials": "semis",
    "software - application": "software",
    "software - infrastructure": "software",
    "internet content & information": "software",
    "information technology services": "it_services",
    "computer hardware": "hardware",
    "consumer electronics": "hardware",
    "communication equipment": "hardware",
    "electronic components": "hardware",
    "electronics & computer distribution": "electronics_dist",
    "scientific & technical instruments": "med_devices",
    "solar": "electrical_equip",
    # Communication services
    "telecom services": "telecom",
    "entertainment": "media",
    "broadcasting": "media",
    "advertising agencies": "media",
    "publishing": "media",
    "electronic gaming & multimedia": "media",
    # Healthcare
    "biotechnology": "biotech",
    "drug manufacturers - general": "pharma",
    "drug manufacturers - specialty & generic": "pharma",
    "medical devices": "med_devices",
    "medical instruments & supplies": "med_devices",
    "diagnostics & research": "med_devices",
    "medical care facilities": "providers",
    "healthcare plans": "providers",
    "medical distribution": "providers",
    "pharmaceutical retailers": "providers",
    "health information services": "health_it",
    # Financials
    "banks - regional": "banks",
    "banks - diversified": "banks",
    "banks": "banks",
    "mortgage finance": "banks",
    "credit services": "banks",
    "asset management": "asset_mgmt",
    "capital markets": "asset_mgmt",
    "financial data & stock exchanges": "asset_mgmt",
    "shell companies": "asset_mgmt",
    "financial conglomerates": "asset_mgmt",
    "insurance - life": "insurance",
    "insurance - property & casualty": "insurance",
    "insurance - diversified": "insurance",
    "insurance - specialty": "insurance",
    "insurance - reinsurance": "insurance",
    "insurance brokers": "insurance",
    # Real estate
    "reit - diversified": "cap_markets_re",
    "reit - residential": "cap_markets_re",
    "reit - retail": "cap_markets_re",
    "reit - office": "cap_markets_re",
    "reit - industrial": "cap_markets_re",
    "reit - healthcare facilities": "cap_markets_re",
    "reit - hotel & motel": "cap_markets_re",
    "reit - mortgage": "cap_markets_re",
    "reit - specialty": "cap_markets_re",
    "real estate services": "cap_markets_re",
    "real estate - development": "cap_markets_re",
    "real estate - diversified": "cap_markets_re",
    # Energy
    "oil & gas e&p": "oil_gas_ep",
    "oil & gas exploration & production": "oil_gas_ep",
    "oil & gas integrated": "oil_gas_ep",
    "oil & gas drilling": "oil_services",
    "oil & gas equipment & services": "oil_services",
    "oil & gas midstream": "midstream",
    "oil & gas refining & marketing": "refining",
    "thermal coal": "coal",
    "coking coal": "coal",
    "uranium": "coal",
    # Utilities
    "utilities - regulated electric": "utilities",
    "utilities - regulated gas": "utilities",
    "utilities - regulated water": "utilities",
    "utilities - diversified": "utilities",
    "utilities - independent power producers": "utilities",
    "utilities - renewable": "utilities",
    # Industrials
    "specialty industrial machinery": "machinery",
    "farm & heavy construction machinery": "machinery",
    "industrial distribution": "business_services",
    "tools & accessories": "machinery",
    "metal fabrication": "building_products",
    "aerospace & defense": "aerospace_defense",
    "railroads": "transport",
    "trucking": "transport",
    "integrated freight & logistics": "transport",
    "marine shipping": "transport",
    "airlines": "airlines",
    "airports & air services": "airlines",
    "engineering & construction": "construction",
    "infrastructure operations": "construction",
    "building products & equipment": "building_products",
    "building materials": "building_products",
    "staffing & employment services": "business_services",
    "specialty business services": "business_services",
    "consulting services": "business_services",
    "security & protection services": "business_services",
    "rental & leasing services": "business_services",
    "conglomerates": "machinery",
    "waste management": "waste",
    "electrical equipment & parts": "electrical_equip",
    "pollution & treatment controls": "waste",
    "business equipment & supplies": "business_services",
    # Materials
    "specialty chemicals": "chemicals",
    "chemicals": "chemicals",
    "agricultural inputs": "chemicals",
    "steel": "metals_mining",
    "aluminum": "metals_mining",
    "copper": "metals_mining",
    "other industrial metals & mining": "metals_mining",
    "industrial metals & minerals": "metals_mining",
    "gold": "gold",
    "silver": "gold",
    "other precious metals & mining": "gold",
    "paper & paper products": "paper_packaging",
    "packaging & containers": "paper_packaging",
    "lumber & wood production": "building_products",
    # Consumer cyclical
    "auto manufacturers": "autos",
    "auto parts": "autos",
    "auto & truck dealerships": "retail_discretionary",
    "recreational vehicles": "autos",
    "apparel retail": "retail_discretionary",
    "specialty retail": "retail_discretionary",
    "internet retail": "retail_discretionary",
    "department stores": "retail_discretionary",
    "home improvement retail": "retail_discretionary",
    "luxury goods": "apparel",
    "apparel manufacturing": "apparel",
    "footwear & accessories": "apparel",
    "textile manufacturing": "apparel",
    "restaurants": "restaurants_travel",
    "lodging": "restaurants_travel",
    "resorts & casinos": "restaurants_travel",
    "travel services": "restaurants_travel",
    "gambling": "restaurants_travel",
    "leisure": "restaurants_travel",
    "residential construction": "homebuilding",
    "furnishings, fixtures & appliances": "homebuilding",
    "packaging": "paper_packaging",
    "personal services": "business_services",
    # Consumer defensive
    "packaged foods": "food_beverage",
    "beverages - non-alcoholic": "food_beverage",
    "beverages - wineries & distilleries": "food_beverage",
    "beverages - brewers": "food_beverage",
    "confectioners": "food_beverage",
    "tobacco": "food_beverage",
    "farm products": "agriculture",
    "grocery stores": "staples_retail",
    "food distribution": "staples_retail",
    "discount stores": "staples_retail",
    "household & personal products": "household_products",
    "education & training services": "business_services",
}


# Hand corrections where the vendor label misrepresents the economics. Kept small and
# explicit: every entry is a judgement that will not be revisited automatically, so
# each needs a reason.
MISCLASSIFIED_OVERRIDES: dict[str, str] = {
    # InterDigital licenses wireless patents to handset makers. Tagged
    # "Software - Application", but its cash flows track device shipments.
    "IDCC": "hardware",
}


def normalise_industry(label: str | None) -> str:
    """Fold vendor punctuation and spacing so lookups are stable.

    FMP emits "Banks - Regional", "Banks—Regional" and occasionally
    "Banks  Regional" for the same industry.
    """
    if not label:
        return ""
    text = label.strip().lower()
    for dash in ("—", "–", "−"):
        text = text.replace(dash, "-")
    text = text.replace("-", " - ")
    return " ".join(text.split())


_NORMALISED_MAP: dict[str, str] = {
    normalise_industry(k): v for k, v in INDUSTRY_TO_GROUP.items()
}


def group_for(ticker: str | None, industry: str | None) -> str | None:
    """Link group for a holding, or None when it cannot be placed.

    None is a real answer, not a failure to paper over: a name with no group gets
    zero confidence from the signal, and scorer.py already excludes zero-confidence
    signals from the weighted sum, so unmapped names simply do not receive this
    signal rather than receiving a fabricated neutral score.
    """
    if ticker and ticker.upper() in MISCLASSIFIED_OVERRIDES:
        return MISCLASSIFIED_OVERRIDES[ticker.upper()]
    return _NORMALISED_MAP.get(normalise_industry(industry))


def coverage(industries: dict[str, str | None]) -> dict:
    """Crosswalk coverage over {ticker: industry_label}, for validating a universe."""
    mapped: dict[str, str] = {}
    unmapped: dict[str, str] = {}
    for ticker, industry in industries.items():
        key = group_for(ticker, industry)
        if key:
            mapped[ticker] = key
        else:
            unmapped[ticker] = industry or ""
    per_group: dict[str, int] = {}
    for key in mapped.values():
        per_group[key] = per_group.get(key, 0) + 1
    return {
        "n": len(industries),
        "mapped": len(mapped),
        "unmapped": len(unmapped),
        "coverage_pct": round(len(mapped) / len(industries) * 100, 1) if industries else 0.0,
        "unmapped_labels": sorted({v for v in unmapped.values()}),
        "groups_hit": len(per_group),
        "per_group": dict(sorted(per_group.items(), key=lambda kv: -kv[1])),
    }


def all_bea_codes() -> set[str]:
    """Every BEA Summary code the crosswalk claims, for validation against a table."""
    return {code for g in LINK_GROUPS for code in g.bea_codes}


def collapsed_groups() -> dict[str, list[str]]:
    """Groups that BEA Summary cannot tell apart, keyed by their shared code set.

    The real resolution of this signal is not the number of link groups -- it is the
    number of *distinct* BEA code sets among them. BEA Summary folds pharmaceuticals,
    biotech and industrial chemicals all into 325, and coal and precious metals both
    into 212, so those groups get byte-identical customer weights however carefully
    the ETF proxies are chosen. That matters for a healthcare-heavy universe: biotech
    holdings inherit chemical-industry links.

    Escaping this needs the BEA Detail table (~400 industries) instead of Summary.
    """
    by_codes: dict[tuple[str, ...], list[str]] = {}
    for group in LINK_GROUPS:
        by_codes.setdefault(tuple(sorted(group.bea_codes)), []).append(group.key)
    return {
        "+".join(codes): sorted(keys)
        for codes, keys in by_codes.items()
        if len(keys) > 1
    }


def distinct_resolution() -> dict:
    """How many economically distinct nodes the crosswalk actually delivers."""
    distinct = {tuple(sorted(g.bea_codes)) for g in LINK_GROUPS}
    collapsed = collapsed_groups()
    return {
        "link_groups": len(LINK_GROUPS),
        "distinct_bea_code_sets": len(distinct),
        "collapsed": collapsed,
        "redundant_groups": sum(len(v) - 1 for v in collapsed.values()),
    }


def etf_proxies() -> dict[str, str]:
    return {g.key: g.etf for g in LINK_GROUPS}
