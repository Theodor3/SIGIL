# Decisions

2026-09-04: User approved seven Gemini workers plus one GPT coordinator, with two novel research roles and five roles covering data, quant, engineering, review and product/ops.

2026-09-04: User requested sandboxing or a separate branch. Created codex/sigil-company from main at 794ee62 in a separate checkout. A Git worktree separates file changes; it is not an operating-system security sandbox. Browser workers have no direct code execution tools here. Coordinator tests must use isolated local fixtures.

2026-09-04: Proposed recurring coordinator cadence is hourly, with at most two new worker assignments and 20 minutes active work per wake after the initial seven-worker batch. The original zero-spend proposal was superseded later that day by the accepted $1/day, $7-total API pilot ending September 11; no quota upgrades or other new spending are authorized.

2026-09-04: Current local broker code uses paper=True. Deployed account/performance remains unverified. Current individual signal backtesting reports gross SPY-relative forecast results and uses calendar-day horizons. It is not a cost-adjusted portfolio simulation.

2026-09-04: User requested a chat audit, worker-to-worker communication and better API planning. Paused the hourly browser coordinator. Six conversations were reread; reopening the seventh hit Google's traffic check. The review chat currently reports a quota limit and Flash-Lite fallback; the exact model used for historical responses is not independently established. R003 and V002 have returned corrections, with remaining evidence questions recorded in the chat audit.

2026-09-04: Proposed replacement is seven Gemini roles under a GPT coordinator using provider APIs, durable task-scoped inboxes, versioned evidence, budgeted runs and isolated execution. Start with two concurrent specialist jobs and one verified collaboration task before recurring operation. This was the pre-implementation design; the later accepted pilot and versioned runtime supersede its pending status.

2026-09-04: Read the user-identified earlier conversation, OpenAI Agent Benchmark Incident. Simplified the proposed first build to a finite Python runner, controller-owned task files/message log, relevant context and a document-only collaboration. Retain seven SIGIL roles; propose Flash-Lite workers and one GPT coordinator, with measured escalation later. User is considering $1 versus $10 daily; recommend $1/day and $7 total for week one without activating spending. Durable recurring infrastructure and sandboxed code execution remain later gates. Peer messages cannot change authority or the evaluator governing their own task.

2026-09-05: Before reconnecting session keys, the user asked to upgrade the whole swarm. Version 0.3 makes the supervised hourly API coordinator the authoritative recurring path while the browser pilot stays historical. It adds readiness-gated dispatch, fixed two-specialist membership plus independent review, a twenty-minute mission deadline, immutable terminal API runs, task-scoped provenance, private/public tool separation, a checked launcher and one-time migration to SQLite/WAL with a checksummed legacy backup. The existing $1 daily and $7 pilot caps remain unchanged. No provider call was made during the upgrade.
