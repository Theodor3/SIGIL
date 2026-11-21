# PR 22 correctness review — November 21, 2026

Reviewed target: `33cc85fdc1b276e32bdf0ff93d8b79fd5b0729f2`, against
`main` at `4d8806fb5507d39a9cbbbc75e4796bc655826b86`. Scope included the
whole diff, fail-closed intake/receipt behavior, exporter/browser parity,
catalog states, private-artifact boundaries and branch/check configuration.
No research, model or provider job was run. Existing private inputs remain
untracked; no frozen pins or public study records changed in these fixes.

## Material findings fixed

1. **Displayed content was not checked against its publication identity.**
   The browser accepted changed experiment records with the previous valid-looking
   `contentSha256`, which could also incorrectly retain curated-update binding.
   A synthetic cold-load regression reproduced acceptance on the reviewed head.
   The page now computes the publisher's exact SHA-256 of the serialized experiment
   array before setting data. Mismatch rejects a cold load and preserves the last
   valid publication on refresh. The final current-effect check remains after the
   asynchronous digest, preserving cancellation behavior. This is consistency
   verification, not a signature or original-source authentication.

2. **Accepted comparisons could contradict the fixed candidate prose.**
   The original positive synthetic fixture passed the gate even though ten-minute
   ridge lost to no change and November thirty-minute ridge beat no change, while
   the generated prose said the opposite. This was reproduced using the reviewed
   head's original fixture/gate. The gate now requires every stated ten-minute and
   monthly thirty-minute ordering under both MAE weightings, including November's
   equal-day no-change comparison. Synthetic fixtures were corrected to match the
   intended narrative. Regressions alter daily errors and recompute consistent
   fold/pooled arithmetic, so rejection specifically tests contradictory claims,
   not just broken totals. Candidate prose and receipt shape are unchanged.

## Supported workflow clarified and verified

The fixed-root real intake CLIs cannot apply the original private 12-entry profile
to the expanded 50-entry checkout. Synthetic intake tests and public catalog checks
work here; they do not imply real intake acceptance. No pin rewrite or generic
intake redesign was made. `intake-review.md` documents a read-only invocation of
the existing exported context/receipt API against the original reviewed source
directory. The exact documented body passed with nine pinned aggregate files and
the original receipt, and rejected the incompatible current root and a relative
root. Generated original candidate semantics matched the saved candidate; the
original candidate hash/receipt remain unchanged. No market inputs were reloaded,
models refitted or reserved observations read.

## Verification and limits

- 32 catalog/exporter/filter/update and 36 intake/receipt Node checks passed
  (68 total), including six arithmetically consistent contradictory-evidence cases.
- Eleven browser regressions passed, including stale-fingerprint cold/refresh
  rejection and all 268 citation URL cases through the actual snapshot validator.
- Build passed existing snapshot-only guards, TypeScript and Vite. Four fresh
  contexts also rendered the actual 50-entry catalog, both latest feasibility
  dossiers and the original Des Moines dossier: no page errors, external or
  unexpected API requests. No backend or source endpoint was started/fetched.
- No catalog entries, statuses, source exceptions, host rules, curated records or
  strategy/execution behavior changed during this review. Scientific claims retain
  their exploratory/descriptive/timing limits; no material study-claim blocker was
  found in the summary review. This does not independently reconstruct research.
- GitHub reported the branch mergeable, zero Actions workflows, no `main` branch
  protection, no rulesets and no effective branch rules. Thus no required GitHub
  checks were configured in the observed repository state. Empty check/status
  results are not passing CI or an actively running workflow. No configuration,
  reviewers, draft state or auto-merge setting was changed.

Remaining limitations include manual/private profile trust, byte consistency
without source authentication, Chromium-only browser coverage and no live
provider/backend integration. The pre-existing large frontend chunk warning
remains. Leave the PR draft and unmerged for review; no deployment is authorized.
