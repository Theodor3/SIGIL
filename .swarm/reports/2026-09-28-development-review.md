# Development review — September 28, 2026

## Working capabilities

The canonical store remains `store_4b6c94a3538f4cb4`. The renewed controller allowance is $100 cumulative estimated usage, counting the previous $1.562843, with a $20 daily throttle and October 28 expiry. There is no automatic renewal or ledger reset. Both configured providers successfully returned their expected model identities. Pricing was checked against the official [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and [Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

Docker Desktop and the trusted test image now work. The real Studio probe passed non-root, read-only-root, missing-key, missing-host/socket, and outbound-network checks. The image is identified in `2026-09-28-container-probe.json`. Controller validation: 137 tests passed; JavaScript syntax check passed. These checks do not establish trading performance or arbitrary application compatibility.

## Tested code draft

Codex independently prepared a two-line future-date guard in `EdgarProvider._scan_filings`. The unchanged source fails four synthetic future-date cases; the draft passes all 20 tests, including today, inclusive 120/180-day boundaries, beyond-window dates, malformed dates and Item 4.02 priority. Both runs used the actual restricted Studio Docker runner, normal module imports and the same test draft. Exact source/draft hashes, full drafts and outputs are in `2026-09-28-edgar-tested-draft.json`. The code remains unapplied. This is a coordinator-authored result, not a successful worker coding result.

## Independent coordinator backtesting audit

Recorded reads and hashes are in `2026-09-28-backtest-coordinator-audit.json`, pinned to commit 58592a076d. `codex_read_1` and `codex_read_2` cover all 151 lines of `api/research/backtester.py`; `codex_read_3` covers evaluator helper lines 81–200. These coordinator records are separate from the rejected worker artifacts.

- Calendar timing: backtester lines 38–40 and 95–100 use date arithmetic. Evaluator lines 85–123 select entry on/after the snapshot date, allowing at most five calendar days of entry delay; exit is on/before snapshot date plus horizon. A minimum elapsed span of max(2, floor(0.6 × horizon)) is required. The horizon is not counted from actual delayed entry and is not a trading-day count.
- Missing prices: backtester lines 87–89 reject a wholly missing benchmark. Lines 102–110 skip missing/invalid stock windows. Lines 113–120 fall back to raw stock return for correctness when benchmark endpoints are unusable. Lines 126–131 exclude those cases from average alpha while retaining them in n and hit rate; if all alpha values are missing, avg_alpha is reported as zero.
- Direction: lines 113–120 subtract benchmark return, retain alpha for long calls and negate it for shorts. A zero basis counts as correct for a short and incorrect for a long because correctness is a boolean equality with `basis > 0`.
- Costs: the fully read backtester has no fee, spread, slippage or borrow deduction in this return/metric calculation. This establishes gross forecast scoring only, not the costs of another portfolio subsystem.
- Risks requiring further validation: same-day close entry may be unavailable at signal creation time; the inspected date-only inputs do not prove intraday availability. Stale benchmark endpoints and missing-data exclusion can alter sample composition. These are possible evaluation biases, not measured effects or performance conclusions.

Three proposed synthetic regression cases (not executed in this audit):

1. Snapshot Saturday 2026-09-26, horizon 5, first price Monday 2026-09-28 at 100, last price Thursday 2026-10-01 at 103: entry Monday, exit Thursday, return 0.03. The three-day elapsed guard passes.
2. Stock return 0.10 and benchmark return 0.04 over valid endpoints: long directional alpha 0.06 and correct; short directional alpha -0.06 and incorrect.
3. Valid stock return 0.10 but a nonempty benchmark with only one eligible dated price: alpha unavailable, long hit counted true using raw return, n includes the observation, avg_alpha is zero if it is the only observation. A missing stock series instead contributes no observation.

## Agent limitations and operational decision

L002 and L003 both stopped on local generation/format failures without saved deliverables. DEV001 (`m_2886707acce34bf3`) verified paid coordinator delegation and provider access but stopped on an invalid engineering response: $0.027201. DEV002 (`m_7186e5e7e43d44ee`) returned invalid source bindings, incomplete source coverage and an out-of-scope peer request: $0.056211. No worker artifact from these runs is accepted. Failed missions remain immutable and were not replayed.

New model spending: $0.083412; cumulative estimate: $1.646255. These are application estimates rather than provider invoices. All reviewed source changes are local and unpushed; the EDGAR fix is still a draft. The existing hourly automation remains paused. The system can assign bounded specialist jobs and run isolated tests, but unattended coding quality is not yet demonstrated. Bionic control remains unverified. Do not refill the queues or claim these failures establish a reliable autonomous workflow.
