# Separate recovered daily history release candidate

Theo approved sharing the recovered paper-account values with existing dashboard-password holders on the existing Railway dashboard. This does not grant trading or uncapped provider spending.

## Scope and data boundary

This candidate branches from main `ee6cd72774ed75d4196a563e450a74945262e165`. It adds the manual Performance card and authenticated GET endpoint, a bounded private-file loader, synthetic tests, and an SPA file-containment correction required before placing private records on the host. No migrations, hourly-history writes, scoring changes, schedules, health-probe activation, or order code are included.

Only after release gates pass, the approved packet destination is `/data/private/recovered-daily-v1` on the existing Railway volume. Required files are `view.json`, exact original `source.json`, `receipt.json`, and `account-binding.txt` containing the independently selected expected account fingerprint. These are private runtime files, never Git inputs or frontend assets. They must be transferred through an authenticated supported interface, verified against the PC copies, and not echoed into public logs. The current candidate contains no actual financial records.

The loader performs no startup reads or writes. A manual authenticated GET runs the bounded file reads in FastAPI's worker pool, validates the source/receipt/account binding, and returns only the prepared response whitelist. Missing, oversized, mismatched or corrupt inputs return unavailable. This is operator-controlled provenance, not independent source authentication. The account fingerprint is not a credential. All holders of a valid configured dashboard session may read the series; the shared password is not individual identity.

Daily observations remain separate from the hourly curve and statistics. Proposed session dates and unknown valuation times remain explicit; no return or alpha calculation is added.

## Local verification

- 16 backend tests passed in an existing Python 3.12 isolated image, networking disabled: source binding, session auth including demo/agent/expired denial, source validation, auth before private reads, no startup reads, unchanged hourly endpoint, encoded URL traversal and symlink escape.
- Six frontend contract/SSR tests passed; TypeScript/Vite production build passed. Existing bundle-size warning remains.
- Windows Git initially converted manifest bytes to CRLF, causing the existing checkpoint digest check to fail. Restoring that file's original LF bytes made verification pass; its Git content did not change.
- Prior browser check covered synthetic unavailable-state rendering only. Actual available-data table, narrow viewport, proxy/session behavior and production activation are not yet certified by this candidate.
- Python 3.11 production-image lifecycle has not been exercised locally. No dependencies were installed or images pulled.

## Current operational gate

The authenticated Railway console reported `auth_configured=true`, `auto_rebalance=false`, `auto_pipeline=true`, and `demo=false`. The pipeline module flag printed by a separate console process does **not** establish whether the serving process has an active job. Main's existing startup activates its scheduler when auto-pipeline is enabled. Therefore a push and automatic restart can start provider work outside this release's verified spending controls. No push, restart, upload or configuration change was performed.

Proceed only after this startup risk and active-run state are resolved through supported controls and the necessary authorization. Do not silently disable or restore production flags, infer permission to spend without a verified cap, or claim rebalancing-off disables pipeline execution.

## Release and rollback once gates pass

1. Recheck remote main and review this exact coherent diff; exclude unrelated local research work.
2. Test the actual application image and verify session/proxy behavior. Preserve automatic rebalancing off.
3. Push the reviewed code and follow Railway through terminal deployment status and exact commit verification. Endpoint must initially report unavailable without private inputs.
4. Transfer only the approved private packet to the specified directory through the authenticated console's supported file transfer, with verification and no raw values in Git/public assets.
5. Verify unauthorized requests are denied, authenticated response is no-store and contains the expected 17 daily rows, and the Performance card truthfully displays the series on desktop and narrow screens.
6. Roll back by removing activation from the application or selecting the prior code version using supported controls. Preserve the private packet and original hourly database; no database rollback is needed. A code rollback can itself restart the scheduler, so the same startup gate applies.
