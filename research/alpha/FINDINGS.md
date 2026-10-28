# Alpha investigation — October28,2026

User priority: stronger alpha research; filing-event investigation stopped.

## Observed production evidence

Authenticated existing Chrome Sigil tab, Overview and System pages:
- Latest displayed completed pipeline run `aa345990`: October3,2026,
  15:30:40 start/15:48:42 finish in browser display timezone.269tickers.
- Read-only `/api/research/backtest-coverage`:74snapshots, July9–October3.
- System five-day summary alpha: value+0.25%, buyback_yield+0.25%,
  forward_value+0.06%, quality+0.04%, insider_pattern_break+0.01%,
  PEAD−0.07%, earnings_momentum−0.11%, short_interest−0.62%.
  These rounded aggregate grades are exploratory and have not been independently
  recomputed. Prediction totals on the page are not independent evaluated n.
- Subtracting an assumed25bps consumes the entire displayed value/buyback mean.
  This is arithmetic sensitivity only, not an executable cost/portfolio estimate.
- A read-only PEAD backtest navigation timed out after10seconds and stayed on
  the coverage page. No result or execution completion is verified; not retried.

## Reliability findings and implemented code

Research list and ticker routes used signal default weights; Overview uses
`load_weights()` (configured group weights). Replaced those two display-only
weight lookups and verified list order, driver contributions, ticker score and
history with synthetic reversed-weight fixtures. No scorer or config change.
These pages still show current configured weights applied to historical scores,
not a recovered original trading decision. No live decision changes.

`screen.py` is new offline forecast diagnostics: verified-source receipt fields,
timezone-aware availability/forecast-before-entry checks, frozen candidate and
holdout boundary, fixed calendar horizon, purged development boundary, all-ID
duplicate exclusion, per-ticker nonoverlap, entry-date-equal weighting, explicit
10/25/50bps assumed costs, negative findings and exclusions. It never accepts a
candidate as alpha and has no runtime/API/broker integration.

Source review found existing backtester has no frozen holdout and repeated daily
windows overlap. Existing evaluator can use earlier SPY dates, fall back to
absolute returns when benchmark missing, and count zero-alpha shorts as correct.
Those paths were not changed; new diagnostics do not reuse those grades.
Same-day snapshot overwrite/date-only metadata cannot establish intraday signal
availability. No local snapshot directory was present in inspected checkouts.

Pipeline staleness is confirmed in production UI; cause is not established.
Scheduler source shares a loop with rebalance waits, has an in-process running
flag, and `_run_pipeline_bg` logs/swallow failures. These are hypotheses for log
inspection, not demonstrated production root causes. No pipeline run, evaluation
write, scheduler restart, rebalance or repair was triggered.

## Validation and remaining evidence

18synthetic tests passed in isolated Docker(imagec2ddeeec7f32, no network, read-only,
nonroot, no host mounts). Includes timing, horizon, purge, duplicate conflict,
overlap, finite mean, costs, empty samples and Research weight regressions.
Separate-context Codex reviewer accepted the final diagnostic and weight change;
review was static, tests were executed by coordinator. No model/API spend.

Required next evidence: immutable read-only export of production context/prediction
rows with creation/completion/source-availability timestamps and code identities,
complete original universe/missing/delisted outcomes, matched stock/SPY sessions,
and an untouched future holdout. No raw export is exposed by the inspected
aggregate backtest endpoint. Read-only production scheduler logs would distinguish
the stale-run causes. No credentials/settings changed to obtain either.

Value v1.0 is a possible preregistered non-filing candidate, with existing sign
and a declared simple momentum baseline; the displayed25bps gross mean is not a
reason to promote it. All historical74snapshots remain exploratory development
unless prior experiment history proves an untouched partition. Do not optimize
weights on this summary or call the prospective protocol a completed experiment.

Nothing pushed, merged, deployed or applied to the running swarm. Existing user
edits and canonical store preserved. Expired API authorization not renewed;
paused six-hour review untouched. No new worker mission launched.
