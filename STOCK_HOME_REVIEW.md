# Stock-first home review build

Isolated branch: `codex/stock-first-home-20261110`, based on cached `origin/main` at `47616aa`. Prepared for the user-approved review-branch push. No merge, deployment, backend startup, paid calls or trading performed. The user's primary checkout was not changed.

## Review

Generate the preview with the export command below, then open `web/preview-artifacts/sigil-stock-home-preview.html` directly in a browser. It is self-contained, denies network connections via CSP, and uses explicitly synthetic stock data. The retained research checkpoint remains dated November 3, 2026; negative, inconclusive and pending findings remain visible. Votes last only for the current page and neither send requests nor launch work.

The installed application uses the existing read-only overview summary at `/`. The old home remains at `/overview`; all other routes remain. Mobile has four primary destinations plus a scrollable More menu. New UI never recalculates scores or invents missing contribution attribution/source timestamps. Score rank, saved confidence gate and portfolio inclusion remain distinct.

Score-history component, Research deep-link integration, helper and focused tests were copied from the separate `codex/score-history-20261110` worktree. Do not duplicate those changes when integrating branches.

## Checks

- Both required research-manifest and company-growth validation scripts pass in offline mode (not source authentication).
- TypeScript and Vite production build pass. Existing large-chunk warning remains.
- Node tests: 155 passed, 4 skipped because retained fixtures were unavailable.
- Browser: stock preview, connected-home fixtures, and legacy overview all pass. Covers keyboard selection, vote/undo, research filters, score-zero preservation, old/no-score states, initial error, deferred refresh/duplicate prevention, recovery, mobile menu close/Back, and Research ticker URL changes/reload/Back/Forward and 320/390px no horizontal overflow.
- Standalone HTML verified via file URL: selection works, no HTTP requests and no page errors.
- Desktop and mobile screenshots inspected. No production or live API behavior validated.

From `web`, run `node node_modules/typescript/bin/tsc -b`, then `node node_modules/vite/bin/vite.js build`. Run `node --test tests/*.test.mjs scripts/*.test.mjs`. Browser tests require `SIGIL_PLAYWRIGHT_MODULE` and optionally `SIGIL_CHROMIUM_EXECUTABLE` pointing to an existing authorized installation. Export standalone HTML with `node scripts/export-stock-preview.mjs` after building. `serve-stock-preview.mjs` optionally serves the build on loopback only and rejects APIs; starting the real backend is not required for these checks.

The user reviewed the synthetic preview and approved pushing this UI. Deployment remains separate from the review-branch push. Generated preview files and delivery helpers are not part of the application commit.

## Final integration identity

Research.tsx SHA256: D0FEC508379DDC543C93B67DD260C514CDC573768CB69B1793A8DAF834F4BE8A

score-history.test.mjs SHA256: B016B6C1D09E1378DF0E4DBBFEEB3119B1EE72614F970448D6ECCD4106283B61

These exact worker-owned files were copied and their hashes verified. The stale ticker URL finding is resolved and verified in a real browser using local fixtures. The attachment preview remains unchanged because it does not mount Research.


The production router does not import or expose StockIdeasPreview. Synthetic ticker examples are excluded from its JavaScript bundle. The preview is a separate development artifact. Votes are explicitly labeled a voting demo on the actual home, with page-only state and no persistence.
