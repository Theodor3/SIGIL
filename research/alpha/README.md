# Offline alpha screening

`screen.py` is a pure offline diagnostic for frozen forecasts and verified outcome
records. It has no API route, imports no application settings and never changes
signal weights, trading inputs, database records or orders. `test_screen.py`
contains synthetic examples only; their returns are not research evidence.

Call `screen(rows, candidate=..., frozen_at=..., holdout_at=...)`. Each row needs
the explicit fields shown in the fixture: candidate/version, forecast ID, ticker,
source receipt, source availability, forecast creation, stock/SPY entry/exit
timestamps, direction and simple returns. Use independently verified immutable
forecast receipts, not retrospectively fabricated timestamps. All conflicting or
repeated forecast IDs are excluded. Calendar-date holding periods must match the
fixed `horizon_days` (default20); weekends/holidays are excluded rather than silently
shifted. This is intentionally strict and is not an exchange-calendar engine.

Development observations whose outcomes reach the holdout-minus-purge boundary
are removed. Same-ticker windows may not overlap. Results give equal weight to
each entry date, with 10/25/50bps assumed round-trip cost scenarios and separate
long/short counts. They do not fit/select a model, assert independence, calculate
portfolio Sharpe or declare alpha. Costs and signed SPY-relative short returns are
forecast assumptions, not realized long/short portfolio PnL.

Required next data acquisition: a read-only immutable export of the74 production
contexts (July9–October3), original prediction/run creation timestamps and code
versions, complete contemporaneous universe and missing/delisted coverage, plus
matched prices. The existing HTTP backtest exposes aggregate results, not the
row panel needed here. Date-only overwritten snapshots alone cannot establish
that a forecast was known before a same-day entry.

Candidate protocol: freeze value v1.0 as one non-filing candidate, preserve the current
sign and threshold, compare against a declared simple momentum baseline, and
reserve a future untouched test period. Past74 snapshots are development only
unless prior experiment/exposure history establishes an untouched historical
partition. No positive signal is accepted from synthetic tests or this proposal.
Track every explored variant; do not select the best result and relabel it OOS.

Tests run only in the established isolated Docker runner, not host Python:
`node run-alpha-tests.cjs` from the enclosing task workspace (runner lives outside
the repository). No production pipeline trigger or external model is required.

