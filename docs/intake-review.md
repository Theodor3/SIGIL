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
data is committed. The fixed-root candidate CLIs are compatibility tools, not a
general import workflow for this expanded catalog. They cannot check the original
SPY bundle against this checkout: that bundle pins a different 12-entry registry,
snapshot and source baseline, and this catalog already contains its study ID.
Missing private inputs on a clean checkout and baseline/duplicate rejection here
are expected. Do not rewrite private pins to force acceptance.
The original outer `verify-intake.mjs` remains a historical bundle
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

## Full receipt verification

The follow-up fix recomputes the complete receipt from freshly validated inputs.
Normal `studies:candidate:check` requires a saved receipt; missing or altered
claims fail. Receipt equality compares parsed JSON objects, so whitespace and
object key order are immaterial. Exact candidate byte hashes remain intentional.
Explicit `check --record` is the sole receipt bootstrap and refuses overwrites;
it does not grant manual review approval. Generation needs no prior receipt.

`node scripts/intake-receipt.mjs` is a read-only CLI using the same required-receipt
path. The package test command includes direct and filesystem CLI tests with
generated fixtures. They exercise missing receipts, forged claims, formatting
equivalence, candidate-byte changes and exclusive-create behavior. A fresh
code-only export can run these tests without any private bundle or dependencies.

## Supported commands on the expanded branch

From this branch's `web` directory:

```powershell
npm run studies:candidate:test  # generated synthetic inputs, not a real intake
npm run studies:catalog:test    # public catalog/publisher consistency and boundaries
```

`studies:candidate:generate`, `studies:candidate:check` and the standalone receipt
CLI resolve their input root from their own checkout. None can apply the original
private profile to this 50-entry checkout. Their failure is not missing research
or permission to regenerate a policy. The tests above do not claim real-bundle
acceptance, and no generic multi-study intake is implemented.

For a read-only check of the original private bundle, retain its entire original
reviewed `source` directory, including the pinned 12-entry registry, snapshot,
protected files, policy, aggregate evidence, candidate and receipt. The existing
exported API accepts an explicit context root; the invocation below uses the
current validator with that unchanged original context. It neither copies data
into this checkout nor writes an acceptance/publication. This exact use was
verified locally: nine pinned aggregate files and the original receipt passed,
and generated candidate semantics matched the saved candidate without changes.

From the current branch's `web` directory, replace the placeholder with the
original reviewed **source directory**, not its parent bundle or a live checkout:

```powershell
$env:SIGIL_REVIEW_BUNDLE = (Resolve-Path 'PATH_TO_ORIGINAL_REVIEWED_SOURCE').Path
@'
import path from 'node:path';
import {ID, loadContext, checkReceipt} from './scripts/intake-study.mjs';
const root = process.env.SIGIL_REVIEW_BUNDLE;
if (!root || !path.isAbsolute(root)) throw new Error('Explicit absolute bundle root required');
const context = loadContext(root);
console.log(JSON.stringify(checkReceipt(context,
  path.join(root, '.swarm', 'candidates', ID + '.json')), null, 2));
'@ | node --input-type=module
Remove-Item Env:\SIGIL_REVIEW_BUNDLE
```

Every original context hash and normal receipt/duplicate/evidence gate still
applies. A current-catalog or altered original context must fail. This is
not an approval, migration, source authentication, receipt bootstrap or supported
way to publish a record. Do not run the historical outer writer as a current
test/build receipt; it contains retained historical assertions and local paths.

The comparative-prose review fix adds checks for all advertised ten-minute and
monthly thirty-minute orderings. It does not change candidate prose or receipt
format. The intended original candidate and receipt still pass unchanged; only
contradictory evidence is newly rejected. Synthetic fixtures now follow the same
orderings and are not research results.
