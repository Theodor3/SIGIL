# Decisions

2026-09-04: User approved seven Gemini workers plus one GPT coordinator, with two novel research roles and five roles covering data, quant, engineering, review and product/ops.

2026-09-04: User requested sandboxing or a separate branch. Created codex/sigil-company from main at 794ee62 in a separate checkout. A Git worktree separates file changes; it is not an operating-system security sandbox. Browser workers have no direct code execution tools here. Coordinator tests must use isolated local fixtures.

2026-09-04: Proposed recurring coordinator cadence is hourly, with at most two new worker assignments and 20 minutes active work per wake after the initial seven-worker batch. No new paid spending or quota upgrades are authorized. Pilot review September 18.

2026-09-04: Current local broker code uses paper=True. Deployed account/performance remains unverified. Current individual signal backtesting reports gross SPY-relative forecast results and uses calendar-day horizons. It is not a cost-adjusted portfolio simulation.
