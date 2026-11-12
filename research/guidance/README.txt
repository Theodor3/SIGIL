Guidance revision experiment v1 — source feasibility only

The user authorized this finite implementation on October 27, 2026 after choosing
occasional trades held for days/weeks. It does not activate a trading signal or
the recurring swarm, and does not change portfolio configuration.

experiment-v1.json freezes the six named issuers and five calendar-release
quarters before return collection. This convenience sample is not suitable for
estimating an investable universe's edge. Latest prior guidance, fiscal period,
units, consolidated scope and public availability must be separately reviewed.

Run from the research checkout:
  node --test research/guidance/guidance.test.mjs
  node research/guidance/collect.mjs NEW_RUN_DIRECTORY

The collector uses free public SEC endpoints only, sequential requests spaced
200ms apart, with an identifying User-Agent. Existing directories are rejected.
Each response (including HTTP failures) gets raw bytes, SHA256, actual receipt
time and status. The saved configuration is hashed. Filing metadata and exhibit
keyword windows are NOT verified guidance. A quarterly earliest Item2.02 filing
is an unverified candidate; all alternatives stay in the slot. Historical batch
retrieval failure is incomplete coverage, never affirmative absence.

The completed original run is .swarm/reports/guidance-audit-2026-10-27-v1.
Its 71 receipts/30 slots/35 exhibits remain unchanged after collection. Collector
failure-state validation was strengthened after that successful run; no claims
are made that an updated script reran or independently timestamped the past.

Publication is offline:
  node research/guidance/publish.mjs RUN SOURCE_MANIFEST OUTPUT [CONTENT_AUDIT]
It verifies raw/config hashes, unique sample slots and exact review excerpts.
The frontend publication strips local raw-file pointers, limits automated
excerpts and marks every event ineligible for return testing. Original raw
documents stay local in the research run; they are not in the web build.
The content review is targeted first-exhibit evidence, not exhaustive absence
certification. Numerical annual guidance can be dollars, a point estimate or
constant-currency growth, which must not be pooled blindly.

compare.mjs only compares dimensional, valid numerical ranges. Low-only raises,
mixed ranges, cuts, rollovers and percentage-point changes remain distinct. It
never certifies eligibility. It has no brokerage or live pipeline connection.

Next finite stage: establish latest prior disclosure and verified historical
availability for comparable pairs, starting with the retained Adobe examples.
If this fails, preserve the failure. No automatic mission/queue refill, paid
model calls, return optimization, push or deployment is triggered by these files.

Offline width candidate screen
------------------------------
node research/guidance/width-screen.mjs EXISTING_RUN CONTENT_AUDIT NEW_OUTPUT

This command reads retained bytes only. It checks configuration/audit hashes,
every content-addressed raw receipt, reviewed source-slot linkage and exact
normalized excerpts before screening the existing coordinator-reviewed numeric
labels. Output creation is exclusive; it never overwrites the archive or an
existing report, fetches a page, requests a model, downloads prices or trades.

The screen groups adjacent reviewed observations with identical ticker, fiscal
target label, metric and unit. These are numeric candidates, NOT verified latest
prior event pairs: basis/scope, semantic labels, intervening updates and actual
first-public timestamps still require independent evidence review. Every record
and summary retains eligibleForReturns=false/0, regardless of numerical results.

compare.mjs now exposes prior/current width, signed width delta and direction,
independent of whether both endpoints were raised/cut. Exact scaled-integer
decimal arithmetic of the supplied numeric labels avoids floating-point false
width events (e.g.23.3–23.4 versus23.5–23.6). Growth-percent widths use percentage
points; dollar widths retain their monetary unit. No forecast or performance is
inferred. Test with:
  node --test research/guidance/guidance.test.mjs research/guidance/width-screen.test.mjs

On the retained30-slot archive:71receipts checked,15numeric annual observations,
9adjacent same-label pairs,6narrowing/3unchanged/0widening candidates. The6narrowing
rows are Adobe2, Salesforce3 and Walmart1. This convenient, first-exhibit sample
is not a representative event universe. Narrowing as fiscal year-end approaches
is an obvious competing explanation; causal/predictive work must control for
remaining fiscal horizon, prior width, midpoint revisions and issuer/calendar
structure before testing on unseen data. No returns have been collected here.
