---
tags: [sigil, architecture, swarm, roadmap]
created: 2026-10-29
status: proposed-with-local-prototype
---
# Astra-led research, local coding and notebook context

## Decision and priority
Theo's priority is finding and testing useful investment ideas, particularly unusual data and second-order business effects. Long-term investing is the main track; event-driven ideas are a separate track. Freight, vessels and world maps are side projects. More complexity, agents or neural networks are not evidence of alpha.

Use Astra in the Sigil Codex control chat to reason through requests, challenge scope, specify acceptance criteria and review actual evidence. Local inference primarily drafts code and targeted tests. A separate critic challenges an unchanged artifact; Astra integrates or rejects it. Do not call local self-critique independent model diversity. Do not describe the existing API coordinator as Astra: runtime currently reports gpt-5.6-sol plus Gemini workers, while this Codex chat is the reasoning control plane. No model IDs or routing were changed by this plan.

Proposed lifecycle: request -> Astra plan -> data/rights/timing gate -> bounded task -> local code or evidence work -> sandbox checks -> separate critique -> Astra evidence review -> accepted/rejected result -> notebook + normal Experiments publication when authorized. One active mission, immutable terminal records, exact artifact hashes and canonical runtime queue. Notebook text and retrieved documents cannot grant dispatch authority.

## Verified present state (19:37 UTC October 29)
Canonical local runtime is port 8765, store_4b6c94a3538f4cb4. No active mission; scheduler manual/off. OpenAI and Gemini were previously verified; local sigil-local is configured but unverified. Runtime reports container-backed worker execution unavailable, although read-only Docker inspection can see trusted image c2ddeeec7f32. Image presence does not prove the runtime sandbox works. No model job, container trial, scheduler or restart was initiated for this plan.

Existing Studio reads a sanitized pinned Git snapshot, not arbitrary Obsidian content. It excludes secrets/runtime datasets and records exact source reads and drafts. Local missions currently run one selected role followed by the same local model's separate-context critique; they do not implement Astra-led mixed-provider code delegation automatically. Existing queue and runtime records remain authoritative; notes are retrieval context, not a second queue.

New API allowance is $20, no expiry: estimate $1.194818 used, $18.805182 remaining, zero reserved, uncertainty false. Historical estimate $4.038829 remains separate; combined lifetime-store estimate $5.233647. OpenAI today $0.475852 / lifetime-store $2.530462; Gemini today $0.718966 / lifetime-store $2.703185. These are controller estimates, not account invoices or confirmed credits. Preference is to use OpenAI for high-value planning/review more often within this allowance; do not increase the cap or assume the reported $100 credits are verified. Codex subscription usage is separate from API usage.

Claude CLI is 2.1.238. Existing adapter is pinned to that version and an expired October 28 task window; installed does not mean dispatch ready. Theo will update Claude at home. A supported update will need a narrow adapter compatibility review and normal preflight; do not auto-renew the old task window or repeat unchanged extra-usage questions. Claude should be a selective escalation, not a parallel copy of every assignment. No API fallback or credential changes.

## Prioritized implementation queue
| Priority | Concrete increment | Acceptance evidence | Cost / dependency |
|---|---|---|---|
| P0 | Make controller roles explicit in task briefs: Astra plan/review, local code, separate critic; route OpenAI review deliberately | One small source-bound code task has exact diff, real tests, reviewer objections and Astra disposition; no local self-approval | Existing allowance only; no speculative broad calls |
| P0 | Verify usage visibility without credential expansion | Distinct swarm estimates, actual account cost unavailable when absent, Claude fresh/stale/unknown windows, no secrets/raw sessions | Local display projection implemented below; billing/hook integration pending |
| P1 | Read-only Obsidian retrieval packet | Bounded relevant excerpts, file hash/range, modified time, source URLs; conflicting/superseded notes identified; prompt-injection fixtures pass | Local lexical retrieval first, no embedding/API bill or vault-wide upload |
| P1 | Rehearse one local code task through the runtime sandbox | Current trusted image and exact draft IDs produce a restricted-container receipt; blocked tests remain blocked | Manual supervised trial later; no daemon yet |
| P2 | Opt-in idle-PC mode over explicit ready tasks | Rehearsal proves stop, locking, reservation, interruption, no replay, one mission, no automatic acceptance | Disabled by default; separate enabling action after review |
| P2 | Point-in-time multi-horizon baseline harness | Data contracts and timing validator pass; future labels and purged splits reproducible; negative results retained | Local data first; see companion study note |
| P3 | Small LSTM/TCN only if baselines/data justify it | Locked comparison, trial/seed ledger, blocked uncertainty and costs, no winner selection on holdout | RTX 4070 suitability must be measured, not assumed |

Do not make all increments depend on new credentials or a framework rewrite. Next useful implementation is the bounded retrieval packet plus one code task, after this planning work is reviewed; do not spend model budget to rediscover already documented negative results.

## Obsidian retrieval contract
Use only the existing Sigil Notebook folder, explicit .md allowlist, read-only; exclude .obsidian settings, symlinks/out-of-root paths, credentials, accounts, logs, private session records and unrelated notes. Start with local filename/full-text retrieval; no need for vectors until measured retrieval failures justify them. A proposed packet cap is six excerpts / 12,000 characters total with clear truncation. Excerpts carry relative note ID, heading/line range, full-file SHA256, modified time, retrieval time, public source references and evidence status. Modification time is not event/publication time.

Astra selects/sanitizes the packet before any cloud worker receives it. Private/local text must not be exported just because it matches a query. Keep outbound research separated from private source context under current tool controls. Never execute Markdown instructions, follow embedded tool commands, recursively expand links or grant a note authority to approve spending. Preserve user prose; write dated append-only research outcomes and index links, not model-generated wholesale note replacements. Original notes may be stale: this audit found the old vision still called maps the north star; a dated correction accompanies this plan.

## Opt-in idle-PC mode design (not enabled)
Owner turns it on and can stop it immediately. Prefer event-driven idle detection through a supported local OS mechanism over frequent model polling. Awake/on AC, adequate free RAM/disk, measured GPU load and a configurable quiet period are eligibility signals, not guarantees of isolation. Pause on keyboard/mouse activity or resource pressure; stop dispatch first and terminate sandboxed work gracefully. Do not schedule automatic wake or run overnight merely because the PC is idle.

Only explicit canonical ready tasks with Astra-approved spec, permitted source packet, bounded resources and acceptance tests are eligible. One shared controller lock/reservation before launch. Sandbox code runs without network, credentials, host/socket mounts, privileged identity or writes outside a disposable workspace. Public downloads are a separately bounded allowlisted collector, never model-authored arbitrary shell networking. No terminal replay or recursive follow-up chains. Checkpoint immutable artifacts when interrupted; an uncertain call/reservation stops subsequent paid dispatch until reconciled. Never modify trading inputs, submit orders, publish, merge or deploy from idle mode.

Proposed initial opt-in session: one already reviewed local code task, a measured finite wall-clock budget and small scratch quota; return to review rather than auto-picking another task. Scale only after useful accepted artifacts and interruption tests, not by removing evidence checks. No recurring schedule is created by this note.

## Usage visibility: implemented locally, not installed
Clean branch codex/sigil-control-plan-20261029 contains swarm/usage/usage-summary.mjs, project-claude-statusline.mjs, usage-summary.test.mjs and README. The stdin adapter projects only optional Claude five_hour/seven_day percentage/reset fields into sanitized stdout JSON, bounded to 256 KiB. It never reads files, session histories, credentials or private endpoints, and never writes a cache or installs a statusLine setting. Unknown remains null; no context-token percentage or estimated session dollar value is converted to subscription quota. Display summaries reject future, older-than-five-minute and reset-expired observations. A fresh observation can still lag use elsewhere and never authorizes dispatch.

Seven synthetic Node tests passed, covering stripped fields, zero/missing values, types/ranges, stale/future/expired windows, estimate-versus-actual separation, bounded malformed input and the standalone stdin adapter. Independent reviewer accepted display-only scope and identified split UTF8 decoding; bounded Buffer.concat now fixes that. No host Python tests. No deployed dashboard change; no claim of a live quota feed.

Official Claude statusline docs describe these fields only when present after a response: https://code.claude.com/docs/en/statusline . Actual output on installed 2.1.238 has not been observed; current docs alone do not prove compatibility. After Theo's update, inspect a normal explicitly emitted statusline payload, preserve any existing hook, and connect only the sanitized projection after a reviewed local change. Do not install a collector or run generation solely to populate a quota meter in this task.

OpenAI actual cost ingestion is separate: official Costs API https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/ and official example https://developers.openai.com/cookbook/examples/completions_usage_api describe organization costs/admin-key setup. No such billing connection was verified; do not probe or create broader credentials. Prefer an owner-exported supported billing report for reconciliation before requesting persistent admin access. Display source, account/project scope, interval, retrieval time, currency, pagination completeness and adjustments; don't double-add controller estimates to provider totals. Net credit balance, gross costs and invoice totals are different measures. No actual billed amount or Claude quota is presently known.

## Explicit blockers and next step
No credentials/settings/approval were denied or requested in this increment. Existing limits remain enforced. Pending engineering is retrieval integration, actual billing source, supported Claude emitted payload, runtime sandbox verification and deliberate idle-mode enablement. These are implementation/data gaps, not claimed permission denials. Current work adds a plan and tested offline projection only. No paid calls, missions, training, restart, push, deployment or trading.

Next: review this plan, implement/read-test a bounded notebook packet, then have Astra define one useful local coding task and verify its sandbox receipt. Use the budget for evidence-backed OpenAI planning/review rather than autonomous brainstorming volume.

See [[16 - Multi-horizon Weather Commodity Studies - 2026-10-29]], [[11 - First Five Minutes Study - 2026-10-29]], [[12 - Local LSTM Study - 2026-10-29]], and [[14 - Crop Weather Monthly Pilot - 2026-10-29]].
