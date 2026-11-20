# Offline intake compatibility review

This code-only import comes from the November 19, 2026 `studies-intake`
local delivery, whose archived source baseline was
`4d8806fb5507d39a9cbbbc75e4796bc655826b86`. The intake additions were
not part of that base commit. This review branch uses that same cached
`origin/main` base; no remote freshness or publication decision is implied.

The import adds an offline, study-specific draft gate and package commands.
It validates aggregate evidence, provenance pins, arithmetic, holdout counters,
and compatibility with the existing publisher in memory. It never writes
the operational registry or reviewed public snapshot. The code's study wording
does not constitute new research verification or permission to publish.

No real candidate, policy, evidence, acceptance receipt, raw prices or reserved
data is committed. Running the candidate command requires a separately supplied,
reviewed private bundle. Failure on a clean checkout without that bundle is
expected. The original outer `verify-intake.mjs` remains a historical bundle
tool, not a repository dependency; it contains historical static check claims
and machine-specific paths and must not be represented as a current report.

`intake-fixture.mjs` generates explicitly synthetic aggregate fixtures in OS
temporary directories. Its invented errors, metadata and simulated test-receipt
text are not observations or results. No real study artifacts are used by the
committed tests. Temporary candidate and policy files are generated only for
validation of code behavior and are removed after tests.

From `web`, run `npm run studies:candidate:test`. No package install, network,
backend, provider, fitting or scoring run is needed.

The private policy pins raw bytes, including newline bytes. Receipts are parsed
JSON; candidate hashes bind exact accepted candidate bytes. Preserve original
private bytes when copying inputs, and never regenerate pins to hide a mismatch.
The working tree's `core.autocrlf=true` does not transform untracked inputs;
this code-only import deliberately leaves those files untracked. Tracking a real
bundle later would need an explicit byte-preservation decision and fresh-checkout
verification. This import makes no portability claim for tracked private data.

Review and port to a future canonical base separately if it differs. Keep existing
publisher, snapshot, catalog, dependency versions and unrelated scripts unchanged.
