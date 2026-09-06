# Continuous SIGIL operations

Status: ready for a supervised hourly coordinator. The finite API runner remains the execution authority; this document cannot expand permissions.

## Objective

Advance one evidence-backed SIGIL improvement at a time on `codex/sigil-company`. Useful outcomes include a rejected hypothesis, a reproducible experiment specification, an inspected draft, or a tested development change. Model agreement and document volume are not outcomes.

## Hourly coordinator cycle

1. Start or locate the local dashboard with the checked launcher, without starting a mission automatically. Confirm `/api/health` reports version 0.3.1, this checkout, the current Studio commit and the canonical store identity.
2. Read `AGENTS.md`, `.swarm/company.json`, `.swarm/board.json`, recent mission status, Studio commit, tool records, drafts, reviews and the budget state.
3. Read `/api/readiness`. If a mission is running, monitor it. Do not launch another. Treat every listed blocker as authoritative; do not work around it.
4. If a mission needs review, verify its source/tool evidence and convert concrete defects into one bounded board item. Do not rerun the same broad audit.
5. Select the highest-value ready board item whose acceptance criteria can be checked with current tools. Use no more than two relevant specialists plus the automatic reviewer unless the task explicitly requires another role.
6. Create at most one narrow mission in a cycle. State required files, allowed research, deliverable and failure criteria. Use the structured `max_revisions` field; the first supervised cycles allow one revision. Use sequential specialist execution only when a later role depends on an earlier role's evidence, and otherwise keep every assignment independently completable. Keep the stable strategy unchanged. A live mission has fixed membership and a twenty-minute controller deadline.
7. Run the mission only when both providers are connected, the controller reports no uncertain spending, and its conservative reservation fits the existing limits.
8. Inspect the final draft, exact check versions, citations and objections. A syntax check is not a behavioral test. An unavailable page does not support a claim.
9. Apply a worker draft only after independent review and appropriate validation. Changes stay on the isolated branch and receive a local commit. Never merge, push, deploy or trade.
10. Update durable records with what changed, what failed, evidence, the next ready task and any decision needed from the user. Stay quiet when there is no material change.

## Acceptance gates

A research task completes only with a precise hypothesis, point-in-time data definition, source limitations, falsifying experiment and explicit statement that predictive performance is unvalidated.

A development task completes only when the current Studio commit was inspected, the draft is tied to source hashes, every claimed check names the exact draft version, reviewer objections are resolved or recorded, and applicable tests actually ran. Docker-unavailable results are blockers, not passes.

A source claim completes only when the retrieved record supports it. An assigned source path must have a completed read with an exact range, full-file hash and pinned commit. Studio paths use `read_file`, never public source requests. Search snippets and publication metadata identify leads; they do not verify a paper's results.

## Recovery

The local dashboard retains missions, events and its ledger in the canonical SQLite database. WAL journaling, foreign keys, a persistent store identity and the controller lock protect one runtime history. The first version-0.3 launch imports legacy JSON once after making a checksummed backup. Submitted API keys remain in memory and must be re-entered after a dashboard restart. If connections are missing, report the blocker once and do not retry provider calls.

Never clear or relocate the ledger, replay an uncertain or terminal API mission, create a second controller, or restart a running mission. A server interruption blocks that run and preserves any unsettled reservation as uncertain. Continue through a focused mission after review. Failed source URLs are recorded so workers do not repeatedly request them.

## Current rollout

The September 4 Studio pilot verified pinned file reads, code search, one cited web-search call, draft storage and JSON syntax checking. It also exposed role expansion and repeated unavailable-source requests. Version 0.3 enforced two fixed specialists, recorded out-of-scope dependencies, separated source-reading roles from outbound research, tied detailed tool context and calls to task IDs, recorded exact draft hashes, and blocked paid work against a stale Studio snapshot.

The September 5 S006 cycle kept the correct membership, verified both provider models and respected private/public separation, but failed the substantive evidence gate. Engineering recorded no reads, workers asserted Item 1A text and acceptance timestamps absent from the pinned source, and prompt prose did not stop a second revision. Version 0.3.1 adds structured revision limits, ordered specialist handoffs, assigned-path reads, exact reviewer source context and retrieval-backed citations. S006 is rejected; its terminal API mission must not be replayed. The next ready item is the narrow S009 field-availability check, which should record the source-grounded incompatibility rather than draft an experiment.

The first hourly cycles should remain supervised. Promote to quieter routine operation after one narrow mission finishes within its assigned roles with reviewable evidence and no repeated tool loops. Container-backed development remains blocked until Docker Desktop and the trusted test image are available.
