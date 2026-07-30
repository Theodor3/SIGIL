"""Load a BEA input-output table and reduce it to customer weights per link group.

The signal needs one thing from BEA: for each industry, how its output is distributed
across the industries that buy from it. Given that, a shock to a customer industry can
be propagated back to its suppliers, which is the Menzly & Ozbas (2010) mechanism.

Input is the BEA Summary-level **Use** table (or any table in the same shape): rows
are producing industries, columns are consuming industries, cells are dollar flows.
BEA publishes these annually and they move slowly, so the file is treated as a static
data artifact rather than a runtime dependency -- no API key, no network call, works
offline, and the matrix cannot silently change under a live book. Obtain it from
https://www.bea.gov/industry/input-output-accounts-data ("Supply and Use" ->
"Use Tables" -> Summary), export to CSV, and drop it at the path below.

The important design decision here is that the crosswalk's BEA codes are NOT trusted.
LINK_GROUPS asserts codes like "3361MV" and "521CI" from documentation, and a wrong or
renamed code would otherwise contribute zero weight and quietly bias the matrix toward
whatever did match. So load() validates every asserted code against the table actually
supplied and returns both the unmatched codes and the table codes no group claims.
A caller that ignores those lists gets a working matrix built on a bad mapping; one
that checks them finds out immediately.
"""
from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from pathlib import Path

from api.research.industry_links import GROUPS_BY_KEY, LINK_GROUPS, all_bea_codes

DEFAULT_TABLE_PATH = Path(__file__).parent / "data" / "bea_use_summary.csv"

# Column headers in the BEA export that are not industries: final-demand columns and
# aggregates. Excluded from customer weights -- household consumption is not an
# industry whose stock return we can observe.
_NON_INDUSTRY_LABELS = {
    "", "iocode", "code", "name", "industry", "commodity",
    "commodities/industries", "industry description", "description",
    "commodity description", "total intermediate", "total commodity output",
    "total industry output", "total industry supply", "total product supply",
    "total final uses (gdp)", "total use of commodities", "total use of products",
    "total value added", "value added (basic prices)", "value added (producer prices)",
    "gdp", "va", "imports", "compensation of employees", "gross operating surplus",
    "other taxes on production", "less: other subsidies on production",
    "taxes on products and imports", "less: subsidies on products",
    "taxes on production and imports, less subsidies",
}


def _is_non_industry(code: str) -> bool:
    """True for anything that is not a producing/consuming industry.

    BEA's Summary export mixes real industry codes with final-demand columns (F010
    personal consumption, F02E equipment investment, F06C..F10N government), totals
    (T001, T005, T019), and value-added rows (V001, VABAS, T00OTOP). The exact set
    varies by vintage, so this matches on shape rather than an enumerated list --
    otherwise a new column code in next year's file silently becomes an "industry"
    that names get scored against.

    Real industry codes are numeric-prefixed NAICS-style (111CA, 3361MV, 521CI) or a
    short handful of letter codes (HS, ORE, GFGD, GSLE, Used, Other).
    """
    text = _norm(code)
    if text in _NON_INDUSTRY_LABELS:
        return True
    upper = code.strip().upper()
    # F-prefixed final demand: F010, F02S, F06C, F10N, ...
    if len(upper) >= 3 and upper[0] == "F" and upper[1].isdigit():
        return True
    # T-prefixed totals: T001, T005, T00OTOP, T013, T019, TOP
    if upper.startswith("T0") or upper == "TOP":
        return True
    # V-prefixed value added: V001, V003, VABAS, VAPRO
    if upper.startswith("V0") or upper.startswith("VA"):
        return True
    # Supply-table margin/adjustment columns
    if upper in {"MCIF", "MADJ", "MDTY", "SUB", "TRADE", "TRANS"}:
        return True
    return False


@dataclass
class IOMatrix:
    """Customer weights over link groups.

    customer_weights[supplier_group][customer_group] is the share of the supplier
    group's measured intermediate output bought by the customer group. Each supplier
    row sums to 1.0 (or the group is absent, when nothing matched).
    """
    customer_weights: dict[str, dict[str, float]]
    supplier_weights: dict[str, dict[str, float]]
    source: str
    # Validation output -- callers should check these
    unmatched_group_codes: dict[str, list[str]]
    unclaimed_table_codes: list[str]
    groups_without_data: list[str]
    # Groups whose customer distribution carries no usable information: either no
    # flows at all, or essentially only a self-loop. Retail is the structural case --
    # BEA books retail output as trade margins rather than intermediate sales, because
    # retailers sell to households, not to other industries. A customer-momentum
    # signal therefore cannot score a retailer, and these groups must be excluded
    # rather than scored off a degenerate row.
    degenerate_groups: dict[str, str]

    def scorable(self) -> set[str]:
        """Groups with a usable customer distribution."""
        return set(self.customer_weights) - set(self.degenerate_groups)


def _norm(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _code_to_groups() -> dict[str, list[str]]:
    """BEA code -> link groups claiming it. A code may feed several groups (BEA folds
    pharma and chemicals into 325, for instance), and a group may claim several codes."""
    out: dict[str, list[str]] = {}
    for group in LINK_GROUPS:
        for code in group.bea_codes:
            out.setdefault(code.upper(), []).append(group.key)
    return out


def _read_table(path: Path) -> tuple[list[str], dict[str, dict[str, float]]]:
    """Parse the BEA CSV into {row_code: {col_code: value}} plus the column order.

    BEA exports carry title rows above the header and footnotes below the data, so the
    header is located by finding the first row whose second cell looks like a
    description column and which has more numeric-ish columns than not.
    """
    with path.open(newline="", encoding="utf-8-sig") as fh:
        rows = [r for r in csv.reader(fh) if any((c or "").strip() for c in r)]
    if not rows:
        raise ValueError(f"{path} is empty")

    header_idx = None
    for i, row in enumerate(rows[:40]):
        cells = [_norm(c) for c in row]
        if cells and cells[0] in ("iocode", "code", "industry", "commodity", ""):
            if sum(1 for c in cells if c) >= 4:
                header_idx = i
                break
    if header_idx is None:
        header_idx = 0

    header = [(c or "").strip() for c in rows[header_idx]]
    col_codes = [c.upper() for c in header]

    data: dict[str, dict[str, float]] = {}
    for row in rows[header_idx + 1:]:
        code = (row[0] or "").strip().upper()
        if not code or _is_non_industry(code):
            continue
        cells: dict[str, float] = {}
        for j, raw in enumerate(row):
            if j == 0 or j >= len(col_codes):
                continue
            col = col_codes[j]
            if not col or _is_non_industry(col):
                continue
            text = (raw or "").strip().replace(",", "").replace("$", "")
            if text in ("", "...", "---", "NA", "n/a", "(D)", "(NA)"):
                continue
            neg = text.startswith("(") and text.endswith(")")
            if neg:
                text = text[1:-1]
            try:
                val = float(text)
            except ValueError:
                continue
            if neg:
                val = -val
            # Negative intermediate flows are inventory adjustments, not purchases
            if val > 0:
                cells[col] = val
        if cells:
            data[code] = cells
    if not data:
        raise ValueError(f"{path} parsed to zero numeric rows; check the export shape")
    return col_codes, data


def _normalise(raw: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for key, row in raw.items():
        total = sum(row.values())
        if total <= 0:
            continue
        out[key] = {k: v / total for k, v in sorted(row.items(), key=lambda kv: -kv[1])}
    return out


def load(path: Path | str | None = None) -> IOMatrix:
    """Build the link-group customer/supplier weight matrices from a BEA table."""
    table_path = Path(path) if path else DEFAULT_TABLE_PATH
    if not table_path.exists():
        raise FileNotFoundError(
            f"BEA table not found at {table_path}. Download the Summary-level Use "
            "table from https://www.bea.gov/industry/input-output-accounts-data, "
            "export as CSV, and save it there."
        )
    col_codes, data = _read_table(table_path)
    code_groups = _code_to_groups()
    # Filter header cells out of the column list the same way the data cells are
    # filtered, or "IOCODE" and "Industry Description" show up as unclaimed industry
    # codes and bury the genuine ones in the validation report.
    table_codes = {c.upper() for c in data} | {
        c.upper() for c in col_codes
        if c and not _is_non_industry(c)
    }

    # Aggregate dollar flows from BEA codes up to link groups. A code claimed by
    # several groups contributes its full flow to each -- these are overlapping views
    # of the same BEA industry, not a partition, so splitting would understate both.
    group_flows: dict[str, dict[str, float]] = {}
    for row_code, cells in data.items():
        suppliers = code_groups.get(row_code.upper())
        if not suppliers:
            continue
        for col_code, value in cells.items():
            customers = code_groups.get(col_code.upper())
            if not customers:
                continue
            # A customer code claimed by several groups has its flow SPLIT between
            # them, not duplicated. Duplicating inflates the row total and dilutes
            # every other customer: with 325 claimed by biotech, pharma, chemicals
            # and household_products, a supplier selling into chemicals showed 64% of
            # its output going to four aliases of one BEA industry, crowding out its
            # genuine customers. Splitting keeps the row summing to the true total.
            #
            # Supplier-side claims are NOT split: several groups reading the same BEA
            # row are separate views of that industry's customer mix, which is
            # correct -- they each get the full distribution.
            share = value / len(customers)
            for s in suppliers:
                bucket = group_flows.setdefault(s, {})
                for c in customers:
                    bucket[c] = bucket.get(c, 0.0) + share

    customer_weights = _normalise(group_flows)

    # Transpose: who supplies each group
    supplier_flows: dict[str, dict[str, float]] = {}
    for s, row in group_flows.items():
        for c, value in row.items():
            supplier_flows.setdefault(c, {})[s] = (
                supplier_flows.get(c, {}).get(s, 0.0) + value
            )
    supplier_weights = _normalise(supplier_flows)

    # Validation: codes the crosswalk asserts that the table does not contain
    unmatched: dict[str, list[str]] = {}
    for group in LINK_GROUPS:
        missing = [c for c in group.bea_codes if c.upper() not in table_codes]
        if missing:
            unmatched[group.key] = missing

    claimed = {c.upper() for c in all_bea_codes()}
    unclaimed = sorted(c for c in table_codes if c not in claimed)
    no_data = sorted(g.key for g in LINK_GROUPS if g.key not in customer_weights)

    # A row that is essentially all self-loop tells us nothing about other industries,
    # so it cannot drive a cross-predictability score.
    degenerate: dict[str, str] = {key: "no input-output flows" for key in no_data}
    for key, row in customer_weights.items():
        self_weight = row.get(key, 0.0)
        if self_weight >= 0.90:
            degenerate[key] = f"self-loop only ({self_weight:.0%} to itself)"
        elif len(row) < 2:
            degenerate[key] = f"single customer ({next(iter(row), '?')})"

    return IOMatrix(
        customer_weights=customer_weights,
        supplier_weights=supplier_weights,
        source=str(table_path),
        unmatched_group_codes=unmatched,
        unclaimed_table_codes=unclaimed,
        groups_without_data=no_data,
        degenerate_groups=dict(sorted(degenerate.items())),
    )


def describe(matrix: IOMatrix, top: int = 4) -> str:
    """Human-readable summary, for eyeballing whether the links look sane."""
    from api.research.industry_links import distinct_resolution
    res = distinct_resolution()
    lines = [f"source: {matrix.source}",
             f"groups with customer weights: {len(matrix.customer_weights)}"
             f" of {len(LINK_GROUPS)}",
             f"effective resolution: {res['distinct_bea_code_sets']} distinct BEA code "
             f"sets across {res['link_groups']} groups "
             f"({res['redundant_groups']} groups indistinguishable at Summary level)"]
    for codes, keys in res["collapsed"].items():
        lines.append(f"  collapsed on {codes}: {', '.join(keys)}")
    if matrix.unmatched_group_codes:
        lines.append(f"!! BEA codes not found in table: {matrix.unmatched_group_codes}")
    if matrix.degenerate_groups:
        lines.append(
            f"!! not scorable ({len(matrix.degenerate_groups)}): "
            + ", ".join(f"{k} ({v})" for k, v in matrix.degenerate_groups.items())
        )
    lines.append(f"scorable groups: {len(matrix.scorable())}")
    if matrix.unclaimed_table_codes:
        lines.append(
            f"note: {len(matrix.unclaimed_table_codes)} table codes claimed by no "
            f"group (final demand and out-of-universe industries): "
            f"{matrix.unclaimed_table_codes[:12]}..."
        )
    lines.append("")
    for key, row in sorted(matrix.customer_weights.items()):
        label = GROUPS_BY_KEY[key].label if key in GROUPS_BY_KEY else key
        top_customers = ", ".join(
            f"{c} {w:.0%}" for c, w in list(row.items())[:top]
        )
        lines.append(f"  {label:38} -> {top_customers}")
    return "\n".join(lines)


def validate(matrix: IOMatrix) -> list[str]:
    """Structural problems worth failing on. Empty list means the matrix is usable."""
    problems: list[str] = []
    if matrix.unmatched_group_codes:
        problems.append(
            f"crosswalk asserts BEA codes absent from the table: "
            f"{matrix.unmatched_group_codes}"
        )
    if not matrix.scorable():
        problems.append("no link group has a usable customer distribution")
    for key, row in matrix.customer_weights.items():
        total = sum(row.values())
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            problems.append(f"{key} customer weights sum to {total:.6f}, not 1.0")
    return problems
