# Eligibility correction review branch

Base: deployed main544b24dfc3b57c9161acaf73db9b9f7cf236b4d5. This branch contains the previously reviewed evidence-only scorer from2ccb5ca, coverage tests and synthetic order-planning tests. It does not include the incompatible experimental attribution snapshot schema or unrelated backtester changes.

Behavior changes: disabled/zero-weight signals no longer inflate or suppress confidence; missing or invalid evidence cannot create eligibility. This can add/remove target holdings. It is not evidence of improved returns. Snapshot tests now expect these intentionally changed outcomes while continuing to check that display capture preserves scorer output.

Validation at8c904bb98e24b415f8efa50aa751184b6bf93574:209 sanitized application tests passed in pinned network-disabled Docker,15 datetime deprecation warnings. Scorer file matches previously reviewed2ccb5ca exactly. No frontend source changed from deployed main. Separate Swarm suite has known identical baseline failures as documented in prior review; not claimed green here.

Publication scope: review branch only, not main, not deployment, no orders or live pipeline. User reports the separate Claude executor is stopped; that scheduler state and JSON flow are being verified separately. Production built-in broker is paper=True and AUTO_REBALANCE=false; this does not independently establish safety of external consumers.
