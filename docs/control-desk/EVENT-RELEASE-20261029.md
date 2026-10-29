# October 29 event workflow release

The production Experiments snapshot adds DSM-TEMP-PAPER-001, frozen locally
October 29 at 21:48:45 UTC for October 30 at 22:00 UTC. It remains unresolved.
Published probabilities use an explicitly uncalibrated assumed distribution;
there is no trading performance, alpha or first-public timestamp claim.
The original forecast records, raw source bytes and SQLite ledger stay local.

Repository swarm additions are standalone event ledger, explicit bounded notebook
retrieval/CLI, and display-only usage/quota projection and static page. Notebook
retrieval is opt-in and does not install a worker context or authorize cloud
transmission. Missing budget/quota fields remain unknown. No billing credentials,
statusline hook, scheduler, worker dispatch or idle automation is configured.
The separate supervised worker-context/test-gate integration remains local and
is excluded from this release because its backend integration has not been
reconciled with current main and the canonical user's runtime changes.

Railway Dockerfile copies api and built web only: the standalone swarm files are
published repository tools, not a remotely running swarm. The local usage page
already runs on port 8765; the production app does not serve that private state.
No database migration, trading setting, strategy input, startup script, API route,
deployment configuration, dependency or order code changes are included.

Pre-release verification: 44 isolated Docker Python tests (14 event ledger,
30 notebook retrieval), 18 JavaScript projection/publication tests and frontend
build pass. Chrome local production preview displays the target, frozen values,
unresolved status, limitations and sources. Astra reviewed code and publication;
review findings were corrected. GitHub has no configured CI checks for PR10;
local tests are not represented as remote CI.

Production merge is explicitly authorized by Theo. No GitHub PR approval is
submitted. Follow Railway's main-branch auto-deploy, verify exact commit and
health plus published snapshot identity. If deployment fails or the new dossier
is unavailable, inspect bounded logs and report or revert this focused release
rather than alter trading configuration. Prior deployed main is
8fc2e25e48d02cceda4064b37c026ddbd65866a6.
