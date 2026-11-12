# Supervised notebook context and deterministic coding checks - 2026-10-29

## Implemented, local branch only

Explicit per-mission selection is now integrated into API, persisted mission data, worker context, private-tool enforcement and local composer. `create_app(..., notebook_root=<approved directory>)` / server `--notebook-root` selects the server-owned root; defaultNone disables retrieval. Clients cannot specify a root. A local mission may pair `notebook_query` with one to six exact `notebook_notes` IDs; live/demo selections, traversal, incomplete selection and oversized packets fail closed. Existing retrieval caps apply. No root/keys/settings were installed on the running server.

The stored untrusted packet and canonical JSON SHA256 pin source excerpts, original note hashes, line ranges, retrieval/mtime and truncation. Mode/role/schema/hash are verified at start, before each provider dispatch and at acceptance. A selected marker prevents missing packets being silently ignored. Only the selected local specialist and local critic receive the packet. Notebook text is in a dedicated data field under a fixed system warning; it cannot change role/tools/budget. MissionTools blocks outbound web/paper/page calls even if a model requests them; local source_requests were already denied. This is structural isolation, not a proof of universal semantic injection resistance.

The composer adds explicit local test-target and notebook-selection fields; engineering makes the test target required, nonlocal modes omit notes, and saved selections clear after creation. A read-only static preview (POSTdisabled) verified these controls and the engineering-required flag; JavaScript syntax check passed. No mission submitted through preview.

## Why the critic missed the failure

Prior NOTEBOOK-CODE-001 generated prose-contained code/tests with requires_testsFalse. The same-model critic inspected text and asserted coverage; no rule required a real passing receipt for the exact code version. Its missing-field test included every field and failed when coordinator actually ran it. Same-model agreement was not test evidence. Original draft/critic/failure and rejected review remain preserved; this increment does not replay it.

## New acceptance gate

Local engineering requires tests; any local quant/other staged coding draft also activates the gate. An explicit bounded Python test target is required. Only staged drafts may run; narrative code is never extracted/executed. After a worker draft, controller can invoke one existing isolated Studio test run if no run was already attempted. It never retries a failed run automatically or bypasses tool/call caps. Latest run_tests record globally must be completed/passed, executedTrue, exitcode exactint0, untruncatedFalse, target and pinned40hexcommit matching. All latest draft IDs/paths/recomputedcontentSHA256 must exactly match checked_drafts. A later failure/wrongtarget or changed draft invalidates prior success. Missing sandbox/draft/target/receipt blocks.

Critic receives explicit test contract and deterministic gate result before critique. Gate is checked again after critic and in the external acceptance endpoint under locks, so prose approval cannot override failed/stale checks. Test success still never accepts code automatically; external evidence review remains necessary. Administrative rejected/superseded review records remain administrative and do not validate artifacts.

## Validation and review

Codex subagent explicitly selected gpt-6-astra reviewed design and final code; this was Astra review, not a claim the swarm coordinator or localmodel changed. Astra caught acceptance/None handling, removed-packet safety, quantcoding bypass, latestreceipt semantics and a UI handler typo; corrections applied. It launched no swarm mission or paid modelAPI. Swarm API model routing unchanged.

59 targeted cases passed before adding two outbound/unauthorizedrole cases. Full unmodified swarm suite:290passed,3failed; failures were existing September budget-renewal positives dependent on current date being before October28. A second full run in disposable Docker ONLY added an autouse historicaldate fixture to that legacy test module:293passed in12.27seconds. Source tests and production expiry rules were NOT changed. Retain this qualification; do not claim293unmodifiedtests passed.

Tests run in trusted c2ddeeec7f32 image, networknone/read-only/capdropALL/nonroot/no-new-privileges/resourcecaps/tmpfs. Because host worktree Git metadata is Windows-specific, runner copies only source/test folders to disposable container storage and initializes a synthetic Git snapshot there. Integration uses deterministic local-provider and Studio-receipt fixtures: no real model generation or nestedDocker/socket. They prove API->persistedpacket->worker/critic->gate->acceptance behavior, not a fresh live model mission. Existing actual source-bound test runner remains the execution mechanism.

New coverage includes exact selected note provenance in both worker contexts, injection text remaining data, no cloud routing, zero actual outbound function calls for specialist/critic, unauthorized recipient stopped before reservation/providercall, traversal/selection/field boundaries, packet mutation/modechange/removal, failing test despite approving critic, stale/changed/partial receipts, quant optout, narrative code, and stale acceptance rejection. Prior30retrievaltests retain context/read bounds and Windows metadata regression.

## Effective status and next action

No new paid modelAPI calls or real swarm missions this increment. At20:07UTC existing canonical swarmidle, allowanceestimateused1.194818remaining18.805182reserved0uncertaintyfalse, schedulerOFF. Real notebook contents were not cloud-exported. No credentials, budget, trading, push, production deployment or running dashboard restart changed.

Implementation is reviewed/tested on codex/sigil-control-plan-20261029, NOT loaded in the current port8765 runtime. That checkout has unrelated user/startup/budget edits; preserve them during a later focused integration and checked idle restart. Approved root must be explicitly supplied at that point; default remainsdisabled. A real selected-context local mission is pending that activation, not claimed completed here. Keep idle scheduling off.
