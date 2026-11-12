# Personal Claude Code subscription route

`swarm/claude_code.py` wraps the unmodified installed Claude Code CLI for one
explicitly authorized, supplied-public-packet review. The controller has a
separate `subscription` mode; it never enters the canonical paid API ledger or
recurring automation.
Do not relabel this route as local/free inference or estimate remaining Pro quota.

Current status: dispatcher and accounting passed the full195-test isolated suite.
After the user restored the existing Pro sign-in, one authorized corrected retry
completed through the Windows dispatcher: `m_8f6cb9f976b64613`, returned model
`claude-sonnet-4-6`, October27 2026. External review accepted the supplied-packet
arithmetic with a midpoint-unit correction (% levels, pp differences). Prior
failed attempt consumption remains unknown. Windows successful launch and
structured output are verified; cancellation was tested with isolated subprocess
fixtures, not by spending another live subscription request. No recurring job is
enabled and the single retry is consumed.

The adapter pins observed CLI version 2.1.238 and refuses a changed version until
reviewed. Each run performs read-only auth status with the same minimal child
environment: only existing OS/profile/temp paths are inherited. API keys, token,
provider, proxy, config-directory and runtime injection overrides are excluded
from that child only. Existing credentials/settings are never read or rewritten
by this module. Existing personal `claude.ai`, `firstParty`, `pro` auth is required.
Managed policy presence blocks the adapter rather than overriding policy.

Launch flags use `--safe-mode`, empty user/project/local setting sources, disabled
hooks, strict empty MCP configuration, no Chrome, no skills, no native tools and
no saved conversation. `--bare` is deliberately excluded because it excludes
subscription OAuth. No bypass-permission flag is used. The caller supplies an
exact model ID; successful output must report only that ID and validate against
the caller's Pydantic schema. No returned tool requests are executed.

The official CLI owns its sign-in. Do not extract OAuth tokens or expose this as
a sign-in option for third-party users. This prototype is for the owner's
personal work, not a hosted subscription gateway.

Before each authorized job, the caller must establish that usage credits are
disabled and pass a fresh `extra_usage_disabled_confirmed=True` assertion. It is
not inferred from CLI auth, stored as a persistent preference, or automatically
read from the account. This assertion alone cannot protect against a concurrent
account setting change. Unknown/enabled credits must keep generation disabled.

The adapter enforces one worker through process and file locks (callers must use
the same canonical lock path), a maximum 120-second timeout, output caps,
cancellation and the October28 12:20Eastern no-new-job / 12:25 stop boundaries, renewed solely for the user-requested freight-packet task on October28. No recurring renewal is authorized.
It sets the documented retry count to zero and disables nonstreaming and refusal
fallback. No fallback model is supplied. Limit/auth/process/validation failures
are terminal to the caller; no automatic retries or external tool loop exists.
Native CLI behavior beyond documented flags still requires live validation.

Results distinguish subscription usage from API dollars. Token counts, model,
input hash and a minimal auth summary are returned; API cost and remaining quota
are null. A CLI USD-equivalent estimate would not prove an actual charge and is
not added to the existing API ledger. The adapter cannot enforce a numerical
Pro allowance. Every result requires external review and a saved attempt receipt.

Controller endpoints (same existing Origin/JSON protection):
- `POST /api/subscription/preflight` with `{}` checks installed version and the
  existing auth route; no generation. Its positive readiness cache lasts120seconds.
- `POST /api/subscription/missions` takes `prompt`, `packet_path` and
  `public_packet_confirmed:true`. The path must be an allowed `docs/*.json`
  supplied-evidence packet in the pinned snapshot with false return eligibility.
- `POST /api/subscription/missions/{id}/run` requires
  `usage_credits_disabled:true`, a timezone-aware ISO `checked_at` within five
  minutes, and a `verification_note`. Dispatch also requires recent auth,
  a current Studio snapshot, idle controller and the authorized time window.
  The adapter rechecks auth immediately before generation.
- Existing mission stop, detail, export and external review endpoints apply.
  Generic mission run cannot bypass the subscription confirmation gate.

One controller-recorded full packet read is bound to the quota receipt by tool
ID, full packet hash and pinned commit. No worker tool loop or automatic critic
is dispatched. Other tool requests are blocked for this mode. `subscription_calls`
are saved inside the canonical mission record, separately from API calls; an
interrupted call retains unknown quota usage without inventing API charges.
The dashboard labels the route as Pro quota and its remaining quota as unknown.
There is intentionally no automatic start/resume control for subscription jobs.

References checked October27 2026 (current docs may describe newer versions):
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/managed-settings
- https://code.claude.com/docs/en/legal-and-compliance
- https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans

User handoff: run the official `claude auth login` and choose the existing Claude
subscription sign-in. Do not use `setup-token`, an API key, or a console login.
Keep usage credits disabled. Do not paste credentials into the chat. Require
fresh verified auth and explicit scope before any future job; do not
automatically repeat a failure. The controller's separate route does not change
existing LM Studio/API modes or their billing meaning.

Per-mission turn allowance: the creation endpoint accepts a strict integer
max_turns from1through8, default2. This is a controller-supplied structured
bound, recorded in the canonical mission and subscription receipt; worker prompt
text cannot expand it. Existing records without the field retain2. The authorized
GUIDANCE010 retry may explicitly select4 once; this does not authorize future
retries or change native tools, auth/billing,90-second timeout, output limits,
model validation, no-fallback policy or stop/deadline gates.

October28 freight retry: one explicit retry may select8 turns after the four-turn attempt exhausted its bound. The default remains2, timeout90seconds, same exact model and Pro-only route, no native tools or paid fallback. This does not authorize further retries. Readiness deadlines now derive from the adapter constants.
