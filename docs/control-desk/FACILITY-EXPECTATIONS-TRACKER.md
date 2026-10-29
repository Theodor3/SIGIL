# Manual facility expectation tracker

`swarm.facility_tracker.FacilityTracker` is an offline Python API using a separate
local SQLite file. It adds no endpoint, worker tool, scheduler, HTTP client, model
call, credential, order path or automatic price retrieval. Existing non-tracker
databases are rejected before schema writes. Never point it at the canonical store.

1. `source`: retain a public allowlisted URL, SHA256 of supplied content, publisher
   timestamp if known and current local receipt time. Bounded content is retained
   transactionally as immutable SQLite bytes and rehashed on read/reuse. Original bytes and rendered
   primary-source notes are distinct representations; the latter never receive an
   original-byte hash. Retain raw files separately if available. Text and timestamps
   remain manual evidence assertions, not automatic publisher verification.
2. `expectation`: identify issuer, facility, production unit and disruption episode;
   record the issuer's expected restart interval. Prospective mode requires original
   bytes, explicit publication time and a window not yet started when recorded.
   Historical material uses `retrospective_audit` and receives today's record time.
3. A revision supplies the latest `prior_id`, preserves episode identity, and appends
   a new version. Stale branches fail; prospective publication times must advance.
   Old guidance remains inspectable. Once confirmed, new disruptions use new IDs.
4. `confirmation`: link actual restart timing to the latest guidance, using closed
   intervals. `actual_start/end` bound uncertainty in the restart time, not an outage
   duration. Earlier/within/later/overlap labels describe operating timing only.
   An uncertain date crossing a boundary stays `overlap_indeterminate`. The record
   separately says whether prior publication precedes operation when that is known.
   Unknown prior publication yields `unavailable_prior_guidance_time`; guidance
   published after operation yields `invalid_hindsight_guidance`, including audits.
   A post-operation guidance version cannot get prospective forecast credit.
5. `price_reference`: attach public issuer/SPY/XLB historical-price references and
   a requested window after a60minute information buffer. Prospective timing uses
   actual source receipt; audit timing uses publisher time if known. The URL symbol
   must match the record. References remain `not_fetched`, with null returns. This
   does not establish exchange sessions, adjusted-price correctness, fills, costs,
   attribution, statistical edge or surprise. No prices are fetched by this tool.

All source, guidance, confirmation and link records are content-addressed and
immutable through the ledger; transaction locks prevent stale concurrent revisions.
One confirmation per episode prevents contradictory truth without an explicit
correction workflow. Corrections/withdrawals are not implemented; preserve the
original and seek a reviewed amendment design rather than modifying history.
Publisher time is not necessarily first publication; machine migration timestamps
and late receipts require source review. A local clock is not external attestation.
No operational-comparison label ever infers a financial surprise or trade.

## Actual prototype run

The2013CVR example is a retrospective audit, received/recorded now from explicitly
rendered-primary notes. The expected UAN date and actual full-plant restart both
fall August3. August7 09:19ET is the confirmation publisher time, not the operation
time. Exact primary acceptance/first public confirmation remain unknown; raw source
requests were blocked and no original-byte provenance is invented. Two public
price-reference windows are linked; no reaction or return was calculated. Formal
timing comparison is unavailable because the prior exact publication time is unknown,
even though the expected and actual calendar dates agree. The
existing cohort gates remain unchanged. There are zero live prospective entries.

The final prototype uses schema2 and `manual-tracker-central-audit.sqlite3`.
Operating day bounds use an explicit facility-local America/Chicago convention
(August UTC-05); the issuer supplied only a date, so this is a convention rather
than verified exact time. Publisher Eastern time remains separate UTC-04.
The earlier schema1database and Eastern-window v2export are preserved as
rejected/superseded development artifacts, not migrated or overwritten.

Current LSB news-index access was denied (numeric status was not retained); no current still-future operating
expectation was verified, and none was fabricated. A live entry requires a newly
received original issuer notice with reviewed target/unit/publication evidence.
No recurring collector or automatic job is activated.

Tests run only in restricted no-network Docker and include revision history,
prospective/audit separation, clock and source ordering, interval uncertainty,
conflicting confirmations, matching price symbols, information buffers, immutable
history, reopen persistence and preservation of unrelated existing databases.
