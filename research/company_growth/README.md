# Prospective company-growth study

Question: do a company’s recent sales growth and operating margin persist into a fully future quarter? This is a business forecast, not a stock-return test.

The first real record is Boeing, issued November4,2026 at14:22:35.486555UTC for January1–March31,2027. Seasonal sales baseline$22.217billion/margin2.01647%; persistence baseline$23.093459billion/margin1.46354%. Outcome remains pending. The record is an export of an independently reviewed local immutable ledger, not independent preregistration or source authentication.

`boeing-frozen-forecast.json` is the exact issued export. `frozen-membership.json` is the separately versioned receipt-based protocol; `parent-membership.json` preserves the original version1 anchor and all20 selected companies. Version1’s local source code and ledger were not changed. No failed historical screen is presented as validated: earlier annual/quarter field and coverage problems motivated this prospective test.

`panel.py`, its vendored project trial ledger, `PROTOCOL.md`, the specific curation plan and offline receipt importer are copied byte-for-byte from the issued revision, preserving its five-file hash. Scoped Git attributes prevent line-ending conversion of these frozen files. The code is deliberately outside the application’s API/import/startup path. No scheduler, model call, order or migration is added.

Raw issuer PDFs/HTML, downloaded holdings, live databases, SQLite ledgers, logs and process state remain local and are excluded from Git. Source URLs, retained hashes, capture times and the reviewed public numeric inputs are in the export. A clean clone cannot authenticate or re-download exact historical bytes, reconstruct the original ledger, or issue from missing captures. Fresh evidence and a separate curator review are necessary for future issuance. The published page is a manually reviewed frozen snapshot, not a live swarm feed or automatic scorer. A past deadline does not turn an unscored forecast into a scored result.

Inventory availability uses actual receipt; inventory publication stays null. Filing acceptance remains separate and does not establish an issuer-hosted PDF’s first availability or byte equality with SEC. Financial figures bind the retained issuer-linked releases. Fiscal calendar dates are a reviewed inference; this implementation supports calendar-year issuers only. Other members remain pending and cannot be replaced. See PROTOCOL.md for the frozen resolution and missing-data rules.

Tests in this folder use labelled synthetic source bytes and disposable databases, never broker accounts or network. The pre-release local evidence run passed98 tests including retained-source checks; the portable Git suite does not claim those raw sources are bundled. To run portable Python tests use the project’s existing isolated Docker runner with network disabled and this checkout read-only. Frontend publication tests run with `node --test scripts/company-growth.test.mjs` from web. Normal frontend build includes its existing checks.

Public view: `/research/company-growth/index.html`, linked from Experiments. Public `forecast.json` is byte-identical to the issued export. All published company figures and metadata derive from public sources; no personal account values are included.
