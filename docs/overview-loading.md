# Overview read path

The overview uses `GET /api/dashboard-data?view=overview`. It returns pipeline/regime/ideas, grouped prediction counts, recent runs and account **configuration mode**, without fetching broker balances/positions or historical evaluation statistics that the overview does not display. It keeps the same authentication middleware. Omitted portfolio values are absent, not zero or demo substitutes.

The default `view=full` remains available to Signals, System and other consumers and retains its account/evaluation fields. Both views use a grouped count query and separate 30-second cache entries. Existing pipeline-success `cache.clear()` invalidates both. This is a smaller first step than a streaming protocol or independent-panel API rewrite: it removes unused dependencies from the first useful overview response.

The shell appears while summaries load. Refresh failures retain the last successful overview with a warning and original run timestamp. Initial failures show an error. Recovery removes the warning. Polling deduplicates in-flight requests; unmount/view changes cancel stale client requests. No trading control, broker implementation, scoring rule or input configuration changes.

Validation:

- Run `pytest -q tests/test_dashboard_overview.py` **only inside the isolated Docker test environment**, with synthetic source/SQLite fixtures, no host execution or service access. It checks 27 signal counts via one query, zero broker/evaluation calls for overview, full-view parity, isolated caches, invalid-view rejection and the existing auth gate.
- Run the existing frontend suites plus `node --test web/tests/dashboard-provenance.test.mjs`, then `npm --prefix web run build`.
- With Playwright and Chromium already installed, run `node --test web/tests/overview-loading.browser.mjs`. `SIGIL_PLAYWRIGHT_MODULE` may point to an existing module file URL; `SIGIL_CHROMIUM_EXECUTABLE` may select an existing executable. The test serves only local synthetic fixtures and blocks other origins. It checks delayed loading, nonoverlapping polls, refresh 503 retention/recovery and initial 503 recovery, with GET-only traffic. It never starts the application backend or contacts a broker.

Production baseline public responses were ~0.12–0.18 seconds, and JavaScript ~238 KB gzip. Authenticated API latency was not measured: direct requests were unauthorized and the supported browser evaluation scope did not expose Performance timing. No production speedup or p95 claim is made before deployment/measurement. Structural reduction is verified: two broker reads and the historical evaluation scan removed from overview; per-signal count queries reduced from N to one. The initial bundle is not reduced by this change, and the existing large-bundle warning remains.
