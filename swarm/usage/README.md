# Usage visibility prototype

Local-only, display-only code. The usage page is linked from the local dashboard; the quota adapter is not connected to runtime collection. No hook, setting, scheduler, credential, model call or billing connection is installed. Existing runtime/store and all reservations remain untouched.

`node --test swarm/usage/usage-summary.test.mjs` runs synthetic JavaScript tests. No Python execution or model API is needed.

`projectClaudeStatusline` accepts an explicitly supplied Claude statusline JSON payload and projects ONLY five_hour/seven_day percentages and reset timestamps plus observation time/source. Missing/invalid fields remain null. It drops paths, session IDs, transcript locations, context utilization, estimated session dollars and arbitrary fields. CLI `node swarm/usage/project-claude-statusline.mjs` accepts bounded stdin (256 KiB), outputs sanitized JSON to stdout, never opens a file or contacts a service, and emits a fixed safe error for malformed input. Do not feed restricted session files into it.

`usageSummary` combines an explicit existing swarm-state object with an optional sanitized quota observation. API estimates remain scoped to this swarm; actual account billing is unavailable/null. Claude quota observations older than five minutes, in the future or with expired reset times cannot imply available quota. A recent observation may still lag concurrent use elsewhere and is not dispatch authority. No dollar conversion for subscription quota.

Official source checked 2026-10-29: https://code.claude.com/docs/en/statusline describes optional rate_limits.five_hour/seven_day used_percentage and resets_at (epoch seconds), present for subscription users after a response. Installed CLI is 2.1.238. Actual emitted payload for that installation has NOT been observed. No generation or settings change was used to test it. Theo plans to update Claude when home; validate a normal supported emitted payload then, preserving any existing statusLine command, before a separately reviewed collector integration.

Account-wide OpenAI billed costs require a separate authorized billing source; ordinary provider token receipts are estimates. Official reference: https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs/ and admin-key example https://developers.openai.com/cookbook/examples/completions_usage_api . Do not create admin credentials for this prototype.

## Live local display - October 29 update
The display-only projection now also lives in static/usage-summary.mjs and is shared via a compatibility re-export. Read-only usage.html/usage.js uses existing local ledger status, clearly labeling estimates and unknown billing/quota. This does not install the statusline adapter: live Claude quota is still unobserved. See docs/control-desk/USAGE-VISIBILITY.md for validation and exact scope.
