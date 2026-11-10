# Combined review branch, 2026-11-10

Base: current fetched main544b24dfc3b57c9161acaf73db9b9f7cf236b4d5. Tested source:e7b1a964ee00f1d0be81a6f4b3e4b5282ecdb42c. Review publication only; do not infer main/deployment approval from this branch.

## Included

- Main's deployed display-only saved scores and manifest portability fix remain intact.
- Reviewed eligibility correction frombdf01b4, compatible with main's snapshot schema; coverage and synthetic order-boundary tests.
- Backtester invalid-output filtering/accounting fromd541d245 and historical verification note7a89a79.
- Reproducible synthetic shadow artifacts fromfdc4dfb, copied byte-for-byte. They demonstrate possible allocation changes, not performance improvements.
- Claude/coordinator WebSocket cleanup and development proxy routing fromdf36ec515d4b776cc6d8eac7b7ad0fbc640b5cc1.
- Claude comparison page at /compare from3f25d42f9ac5160f41a0bc94cac87ed84f197a1d, including missing-company and UTC regression coverage.
- Deterministic clock in a previously time-sensitive research-checkpoint rendering test; production behavior unchanged by that test repair.

## Verification

Exact tested source:244 application tests passed in pinned offline Docker,18 warnings (datetime deprecations and explicit synthetic result warnings). Full frontend production build passed;150 static tests,146 passed,0 failed,4 retained-private-evidence skips. Node22.23.4. No host project tests. Source archive SHA256:7e71a050558ac030cd3e98af60c7f7ba3daba3e57df6a35cf46836f008a66395. Independent source review found no blockers for review-branch publication. Frontend bundle-size warning remains; real-browser validation not performed. Separate Swarm suite was not rerun on this source and has known baseline failures; it is not claimed green.

Comparison limitation: run alignment compares timestamps rather than unique run IDs. No live services, market-performance testing or account verification was performed by these tests.

## Preserved/excluded

No dirty user files were overwritten. Original checkout .gitignore, .codex and uncommitted CLAUDE.md were not swept in. Older experimental canonical-attribution/scoring-validation branches were superseded by the safer main-compatible display split and are not merged wholesale. Unrelated historical company/research/swarm branches were not treated as current finished changes.

## Execution boundary

This note supersedes historical operational claims in copied branch reports. The external Claude Robinhood task was last independently verified Active with automatic order instructions; its latest observed access failure is not a disabled schedule. This branch changes eligibility and therefore can change external target weights. Main merge/deployment remains held pending appropriate execution isolation/handoff. No orders, production settings, live pipeline or deployment were changed in assembling this review branch.
