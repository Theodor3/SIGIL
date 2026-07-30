# Static research data

## `bea_use_summary.csv` — not in the repo, download it

`api/research/bea_io.py` expects a BEA Summary-level **Use** table here. It is not
committed: it is a ~1MB government data file that changes once a year, and pinning it
as a downloaded artifact keeps the input-output matrix from silently changing under a
live book.

**To obtain it:**

1. Go to <https://www.bea.gov/industry/input-output-accounts-data>
2. Under *Supply and Use* → *Use Tables*, pick **Summary** level, most recent year
3. Export/save as CSV to `api/research/data/bea_use_summary.csv`

No API key needed for the manual download. (The BEA API does require free
registration, which is why the loader reads a file instead.)

**Expected shape** — rows are producing industries, columns are consuming industries,
cells are dollar flows:

```
IOCode,Industry Description,111CA,113FF,211,...,F010,T001
111CA,Farms,12345,678,...
113FF,"Forestry, fishing",...
```

The loader tolerates BEA's export quirks: title rows above the header, footnotes
below the data, `,` thousands separators, `(1234)` parenthesised negatives, and
suppressed cells (`...`, `(D)`). Final-demand columns (`F010`…) and totals (`T001`…)
are excluded — household consumption is not an industry whose return we can observe.

## Verifying the download

```bash
python -c "from api.research import bea_io; m = bea_io.load(); print(bea_io.describe(m)); print(bea_io.validate(m) or 'OK')"
```

`validate()` returns an empty list when the matrix is usable. A real Summary table
should produce **few or no** `unmatched_group_codes`. A long list means the crosswalk's
asserted BEA codes disagree with this vintage of the table — fix
`LINK_GROUPS[*].bea_codes` in `api/research/industry_links.py` rather than ignoring it,
because unmatched codes contribute zero weight and quietly bias the matrix toward
whatever did match.

Sanity-check the printed links before trusting them. Semiconductors should sell mostly
into hardware and software; farms should sell into food and beverage. If the top
customers look arbitrary, the parse or the crosswalk is wrong.

## Known resolution limit

BEA Summary has ~71 industries and folds pharmaceuticals, biotech and industrial
chemicals into a single code (`325`), and coal and precious metals into `212`. Those
link groups therefore receive identical customer weights no matter how their ETF
proxies are chosen — `industry_links.distinct_resolution()` reports exactly which.
Escaping that needs the BEA **Detail** table (~400 industries), which is published
less frequently and on a longer lag.
