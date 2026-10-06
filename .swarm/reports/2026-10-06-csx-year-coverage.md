# CSX 2025 report-file cohort: coverage audit

All 53 distinct report-date URLs in the saved 2025 STB index downloaded and parsed successfully on October 6, 2026 UTC. Each workbook has six sheets and a seven-day reporting interval in Rail Service E3/E4. Sorted intervals are contiguous with no gaps or overlaps. The first report (2025-01-01 filename) covers 2024-12-21 through 2024-12-27; the last (2025-12-31) covers 2025-12-20 through 2025-12-26.

This is a complete 2025 report-file cohort, NOT complete calendar-year 2025 observation coverage. A calendar-year study needs the adjacent January 2026 report containing December 27 onward and an explicit week-allocation policy. Filename dates must not be substituted for reporting-period dates or verified public availability.

Raw workbooks, source URL/retrieval-time/hash receipts, decoded cell inventories, annual-audit.json and coverage-summary.json are in the conversation workspace outputs/csx-evidence/2025. Read-only PowerShell ZIP/XML extraction used cached Excel date serials. A first local parser pass failed on null entries from blank XML rows; skipping those fixed extraction, without downloading files again. No spreadsheet macros/formulas executed. No application tests or paid calls were used.

Remaining: verify category identities/units and metric validity across the set, inspect adjacent boundary report, and document original-publication uncertainty before modeling. No predictive result or point-in-time validity is claimed.
