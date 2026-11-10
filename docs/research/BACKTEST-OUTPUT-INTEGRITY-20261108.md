# Backtest output integrity, 2026-11-08

## Result

Prepared a local, offline-only validation change based on `cf22fd7269cd05186ce985b15923162b2d93af30` on branch `codex/sigil-evaluation-integrity-20261108`.

The prior backtester compared score/confidence directly. IEEE NaN fails both the abstention check and the bullish `score > 0.5` check, so an invalid score could be counted as a bearish forecast. A NaN confidence could also pass the confidence gate. This is a code-path finding, not a claim that stored experiment results were affected.

The replay now rejects individual outputs with nonnumeric, boolean, nonfinite or out-of-range score/confidence, missing fields, or blank/padded/nonstring tickers before any price request or horizon denominator. Valid endpoints 0 and 1 remain eligible; zero confidence and neutral scores remain abstentions. It reports `output_counts` for all observed outputs, invalid outputs, abstentions and accepted calls, including when no valid calls remain. Existing matched-SPY, timing and cost rules are unchanged.

31 new parametrized regression cases cover both numeric fields, malformed ticker identities, missing output fields, no-download behavior, valid endpoints, and denominator/accounting conservation. This is per-item validation: a compute implementation returning a non-iterable batch remains a separate pre-existing robustness gap.

## Verification

- PASS: Python AST syntax parsing of both changed Python files, using the installed Python 3.12 runtime. Project modules were not imported or executed.
- PASS: `git diff --check`.
- PASS: independent read-only static review found no blocking regression in changed validation/accounting.
- NOT RUN: pytest or aggregate runtime checks. Docker engine discovery returned `Access is denied` for `dockerDesktopLinuxEngine`. The repository requires isolated Docker test execution, so no host test fallback was attempted. The default WindowsApps Python alias also failed; the existing runtime was used only for syntax parsing.

Next verification when the authorized Docker runner is available: execute `pytest -q tests/test_backtest_reporting.py tests/test_point_in_time.py tests/test_evaluator_provenance.py` with the repository's isolated fixture runner, no network, no broker credentials, and temporary databases; run the remaining applicable suite before publication. This change is locally prepared, not runtime-verified or ready to deploy.

## Scope and retained studies

No paid calls, fitting, trading, source requests, deployment, remote push, service restarts or schedules. No historical metric was recomputed or rewritten. Existing user work and canonical budget/ledger state were not modified. The local November 1 ERCOT and river forward packets remain unchanged; this change does not resolve their outcomes or establish predictive skill.

## Follow-up verification, 2026-11-09

After the owner reported restored access, GitHub and Docker access succeeded on DESKTOP-MDURS43. The unchanged implementation commit `d541d2452582ad718c26588f44e0f5bc27901010` was tested through the existing GitStudio isolated runner and pinned image `sha256:c2ddeeec7f32f1717584654d6a4cbc20ee2b454cad49a2fefd911d2cff8bed9d`.

- `tests`: **168 passed**, one pre-existing datetime.utcnow deprecation warning, exit 0, untruncated output.
- `swarm/tests`: **316 passed, 16 failed, 11 errors**, exit 1. Re-running the same target on the unchanged parent commit `cf22fd7269cd05186ce985b15923162b2d93af30` produced the same failed/error test names and counts. These failures are not introduced by this backtester patch. They include the sanitized runner lacking a Git snapshot required by some app/queue tests; the full aggregate suite is not green.
- The runner retained no-network, read-only root, non-root user, no host mounts, dropped capabilities, 1 CPU, 256 MiB and a 45-second timeout. No packages were installed and no paid model calls or live services were used.

The focused repository suite now passes, superseding the earlier Docker-blocked test status above. Suitable for publication on the review branch only; no merge or production deployment is implied. The current remote main may be newer than this branch's base and integration against it remains separate work.
