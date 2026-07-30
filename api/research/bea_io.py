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
_NON_INDUSTRY_COLUMNS = {
    "", "iocode", "industry description", "description", "commodity description",
    "total intermediate", "total commodity output", "total industry output",
    "total final uses (gdp)", "total use of commodities", "total value added",
    "f010", "f020", "f030", "f040", "f050", "f100", "f: total final uses",
    "gdp", "t001", "t004", "t005", "t006", "t007", "t013", "t018", "va",
    "compensation of employees", "gross operating surplus",
    "taxes on production and imports, less subsidies",
}


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
        if not code or _norm(code) in _NON_INDUSTRY_COLUMNS:
            continue
        cells: dict[str, float] = {}
        for j, raw in enumerate(row):
            if j == 0 or j >= len(col_codes):
                continue
            col = col_codes[j]
            if _norm(col) in _NON_INDUSTRY_COLUMNS or not col:
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
        if c and _norm(c) not in _NON_INDUSTRY_COLUMNS
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
            for s in suppliers:
                bucket = group_flows.setdefault(s, {})
                for c in customers:
                    bucket[c] = bucket.get(c, 0.0) + value

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

    return IOMatrix(
        customer_weights=customer_weights,
        supplier_weights=supplier_weights,
        source=str(table_path),
        unmatched_group_codes=unmatched,
        unclaimed_table_codes=unclaimed,
        groups_without_data=no_data,
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
    if matrix.groups_without_data:
        lines.append(f"!! groups with no flows: {matrix.groups_without_data}")
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
    if matrix.groups_without_data:
        problems.append(f"link groups with no input-output flows: {matrix.groups_without_data}")
    for key, row in matrix.customer_weights.items():
        total = sum(row.values())
        if not math.isclose(total, 1.0, abs_tol=1e-6):
            problems.append(f"{key} customer weights sum to {total:.6f}, not 1.0")
    return problems
