# Archive and storage investigation — October28,2026

Read-only production Railway UI evidence, production environment:
- `sigil-volume` warning:99%capacity.
- Scheduler logs repeatedly show `sqlite3.OperationalError: database or disk is
  full`, including01:21:09,03:45:31,09:57:21 and10:30:14EDT October28.
- Scheduler prints `Pipeline completed` before errors and schedules another
  check in0.2hours. Source `_run_pipeline_bg` catches exceptions rather than
  propagating success/failure, so that line is not proof a new run was committed.
- Equity snapshot also fails with the same SQLite error at09:48:20EDT.
- Volume capacity and write failures identify a concrete storage incident;
  precise disk consumers, quota/free-page/WAL split and first failure date have
  not been established. Do not infer database corruption or lost historical rows.
- Separately, unfiltered recent logs showed yfinance/Pandas deprecation flooding
  and Railway messages dropping logs at a500logs/sec rate. This limits log
  completeness; it is not proof of the disk-filling cause.

No deletion, VACUUM, checkpoint, restart, volume resize, billing change, database
copy, pipeline/evaluation trigger or trading operation was performed. Repair
needs a consistent supported backup, storage inventory, targeted retention or
capacity decision, then an explicit verification plan before trading-related
services resume. The current research task did not authorize those mutations.

## What can be exported honestly?

Original predictions may survive: schema stores prediction ID, run, signal
version, score/confidence and metadata. Runs store UTC-naive started/finished
times, but finished_at is assigned before commit; it is not exact publication or
durability evidence. Existing evaluations omit exact stock/SPY entry/exit dates
and price receipts. Repricing would be retrospective current-vintage matching.
Contexts overwrite per date and are saved before regime/LLM-focus steps; they
lack immutable run/code/source-vintage identities. They cannot prove every
historical forecast's inputs or availability. No complete production row export
was found through the inspected HTTP routes; agent/book is a reconstructed
target-book view, not a full original forecast/outcome export.

New `export_forecasts.py` supports only a supplied coherent offline SQLite copy:
read-only/query-only consistent transaction, three whitelisted research tables,
source timestamp preservation, count/orphan diagnostics, conservative byte
preflight, per-table row bounds and content-addressed output. Never casually copy
a live WAL main file or pin a long read transaction on the nearly-full volume.
Tested on synthetic databases only; not executed against actual app/swarm data.

## Local outcome export actually built

All5 archived Yahoo ETF raw files matched their original receipts. Each contains
2513rows; one retrieval-day partial session was excluded, leaving2512complete-date
observations, October27,2016–October26,2026. Exact20-calendar-day stock/SPY matches
yield7816outcome-only rows for EFA/IEF/GLD/BIL; each has558excluded missing exact
exit windows (includes non-session and immature windows). No unmatched benchmark
windows were found among retained outcomes. No original forecasts are present.

Local-only file outside the Git worktree:
`../alpha-lab-data/a45ce15a43a668735a862fc899cf93209e2dad7127c80b535dba39f099f7d856.json`
SHA256 equals filename;1,854,419bytes. Original/source hashes and acquisition
times retained; all rows label pointInTimeForecastEligible=false. Existing
hash-addressed exports are verified and never overwritten by the tool.

The forecast alpha diagnostic was not run on these outcomes: manufacturing
forecast creation times would defeat its evidence checks. No newly validated
alpha results. Existing diversified archive remains an earlier negative screen,
not a new experiment or untouched out-of-sample result.

Tests:21Python regressions passed in restricted offline Docker;6Node archive
audit tests passed. Independent review verified raw hashes and constraints and
accepted the tools for the scoped offline audit. Bulk output remains local.
