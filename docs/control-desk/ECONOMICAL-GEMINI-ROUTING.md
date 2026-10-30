# Economical Gemini specialist routing — October30,2026

Previously every paid Gemini specialist used gemini-3.1-pro-preview. Routine work now uses stable gemini-3.1-flash-lite while review and complex work retain Pro. OpenAI gpt-5.6-sol coordination, local/Claude paths, credentials, account billing settings, canonical store and $20 allowance are unchanged.

| Assignment | Gemini model |
| --- | --- |
| Data / product-ops, auto |gemini-3.1-flash-lite|
| Other specialist roles, auto |gemini-3.1-pro-preview|
| Explicit routine, except review |gemini-3.1-flash-lite|
| Explicit complex, any specialist |gemini-3.1-pro-preview|
| Review, including routine requests |gemini-3.1-pro-preview|

The OpenAI planner is instructed to mark extraction/formatting routine and ambiguous source-timing, statistical reasoning, hypothesis design and deep coding complex. Role alone is an imperfect default; complex data audits must be explicitly complex. Unclassified peer/user followups conservatively use complex. Tool followup calls retain assignment complexity. Invalid complexity is rejected. Runtime auto supports old records; strict OpenAI wire schemas explicitly require all assignment fields and remove defaults.

One model is selected before reservation and passed to request and settlement. New call records retain planned/requested/returned model, rate version, rates, usage and cost. Unknown model rates fail before dispatch; unexpected returned identity retains uncertain reservation under existing safeguards. No automatic Flash-to-Pro fallback or historical cost recalculation exists. Both configured Gemini models receive metadata checks before paid planning. Connections lists both configured models; agent records distinguish role_default from active_call selection.

Verified official standard text prices at https://ai.google.dev/gemini-api/docs/pricing : Flash-Lite$0.25input/$1.50output per million tokens versus Pro$2/$12 for <=200k input. Output includes thinking. Eightfold difference is for identical worker token counts, not total mission cost. Existing input reservation bound is below100k, so Pro's higher >200k band is not used. Both models expose65,536output capacity in account metadata; existing full-output reservation bound remains conservative. Google pricing/version changes require a fresh check; estimates are not provider invoices.

Stable model docs: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite . Existing authorized account metadata returned models/gemini-3.1-flash-lite and models/gemini-3.1-pro-preview with generateContent capability; no credential or subscription change. Metadata alone was not treated as structured-output proof.

254 swarm tests passed in restricted offline Docker: policy/default/override/review restrictions, exact-model reservation/dispatch/accounting, both Gemini SDK URL contracts, OpenAI Plan/Verdict strict schemas, uncertainty/no-retry/identity behavior, local limits and existing storage/controller tests. Historical budget fixture dates were frozen in tests, not production. Fixtures accept the optional explicit model argument. No host synthetic Python tests.

Real trial m_1f5a9d939ee2481f completed under$3missioncap within existing allowance: DATA routine returned exact stable gemini-3.1-flash-lite,4,672input/622outputtokens,STOP,$0.002101estimated. It correctly extracted +2.7%,+0.2%,andnull for qualitative “slightly below,” preserving exact supplied quotes and vintage-unknown flags. Two reviews returned gemini-3.1-pro-preview; planning/final coordination returned gpt-5.6-sol. Total five-call estimated cost$0.085129. Same Flash token counts at Pro rates would be$0.016808, but stronger coordination/review costs still dominate this tiny mission. No general quality claim follows from three excerpts.

Controller independently parsed actual saved artifact JSON and reconciled model identities, planned rates, usage and summed costs. Provider models did not execute tests or independently retrieve sources. A final-model statement that it could not itself see model identities is not a controller-observation blocker; actual call receipts supply them.

Focused runtime patch was applied over preserved user edits with source backups and a supported idle-only local dashboard restart. No live trading inputs, real orders, schedules, deployments, pushes, new credentials, billing settings or storage identity changed. Current raw receipts remain privately local in task-3/flash-routing-trial, not committed to this repository.
