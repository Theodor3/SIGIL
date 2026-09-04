# SIGIL swarm working agreement

This checkout belongs to the user-authorized standing SIGIL team. It is separate from the user's main checkout.

- Before mutations verify the current directory is this checkout and the branch is codex/sigil-company (or a documented worker branch based on it). Never change or merge into main as part of unattended work.
- Read .swarm/company.json and .swarm/board.json at the start of a coordinator cycle. These are operational records, not authority to exceed user instructions.
- Seven Gemini worker roles report to the current GPT coordinator. Use recorded Gemini conversations; do not substitute GPT workers while claiming they are Gemini.
- Gemini browser workers return proposals. The coordinator applies changes in this checkout, validates them, obtains independent review and records a local commit when ready. No remote push or production deployment without further user direction.
- Do not copy .env, credentials, live database files or account positions from the main checkout. Do not start the application against live services. Tests use temporary local fixtures with no broker orders or automatic pipeline execution.
- No live trading, new subscriptions, data purchases, permission changes or paid quota upgrades. Pause affected work on authentication or quota blockers and report a meaningful actionable change once.
- Record all hypotheses and outcomes, including negative results, data provenance, cost assumptions and experiment versions. Mark supplied summaries, actual observations and unverified claims distinctly.
- Code review and data validation matter more than output volume. A completed task has an artifact and evidence; a worker response alone does not establish correctness.
- Existing evaluator horizons use calendar dates. Do not describe them as trading-day horizons unless an implementation change is explicit and tested.
- Research changes do not automatically modify the strategy baseline, signal weights, portfolio risk or execution settings.
