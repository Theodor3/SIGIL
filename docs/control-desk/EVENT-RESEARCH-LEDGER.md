# Local event research ledger

`swarm.event_ledger.EventLedger` is a standalone local Python API. Supply a new
research-only SQLite path outside Git; never use the canonical swarm database.
There are no network, model, broker, scheduler or automatic dispatch integrations.

Workflow: `receipt(source, sha256, available_at, received_at)` records an original
source digest and declared provenance; `forecast(event_id, definition, decision_at,
target_at, probability, receipts, model)` freezes a binary event forecast; `resolve`
links its boolean outcome and evidence receipt; `score` returns descriptive Brier
error only. Arguments for these methods are keyword-only except forecast ID on
resolve/score. Close the ledger after use.

Sources must be both available and received by the decision. Target must be
strictly future relative to that decision, and resolution cannot precede target
or outcome receipt. All timestamps require explicit timezones. Event definitions
and target times cannot change under an existing event ID; probabilities may be
revised in new immutable forecast records. Source hashes are researcher supplied:
this component does not fetch bytes or verify issuer claims. Notes are untrusted
research context, never execution authority.

Content-addressed records, transaction rollback and mutation triggers preserve
history through the API. Duplicate identical records are idempotent; a forecast
can resolve only once. Read-time hash checks detect changed bodies. This is not a
tamper-proof archive against a database administrator. Declared timestamps can be
backdated; it is NOT proof of prospective execution or public release history.
Do not call retrospective entries point-in-time validated without independent
receipt evidence. No outcome means no score. One Brier score does not establish
calibration, model superiority, an investment edge or profitable option pricing.

Next: supply a reviewed, finite event cohort with original bytes, attested capture
times, a fixed definition and baseline forecasts; aggregate scores by event rather
than treating multiple revisions as independent samples. Execution prices,
conditional asset reactions and option premiums belong to separate evidence layers.

## Verification October 29, 2026

Restricted no-network Docker tests cover provenance timing, invalid probabilities,
timezone handling, immutable records and replacement, fixed event identity,
reopen persistence, hash corruption, resolution timing and rollback. Synthetic
fixtures are not observed market evidence. Astra Codex subagent reviewed design
and code; no swarm paid API calls were required.

Runtime warning diagnosis: Docker was healthy but the expected local image tag
`sigil-swarm-tests:pilot` was missing. Restored it to the already verified local
image `sha256:c2ddeeec7f32f1717584654d6a4cbc20ee2b454cad49a2fefd911d2cff8bed9d`.
No image download, daemon permission change or isolation relaxation was needed.
