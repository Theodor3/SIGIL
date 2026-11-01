# Finite Claude packet runs

The dedicated subscription run request now supplies two explicit aware ISO timestamps: `no_new_after` is the latest launch time and `stop_at` is the hard stop. Both must be future, ordered, and at most thirty minutes from validation. The controller preserves those exact bounds in the mission approval and subscription receipt, then passes them to the existing adapter. Expired, omitted, malformed, reversed or oversized windows fail closed. Historical adapter defaults remain expired; nothing automatically renews them.

`checked_at` records the operator's confirmation for this particular run, within five minutes of dispatch. It does not claim that a billing page was just inspected. Theo already confirmed extra usage is OFF; the operator can retain that owner assertion in `verification_note` without asking him again or pretending to make a new account observation. Authentication separately proves only the supported Pro route. Subscription remaining quota and dollar cost remain unknown and separate from the API ledger.

The next operator action is to select one reviewed public-packet mission, perform the read-only preflight, then explicitly submit that mission with a finite window. The window is supplied once for that run; terminal missions cannot replay. Packet/tool isolation, CLI version pin, fresh auth check, cancellation, ninety-second generation timeout, external review, and no API fallback remain enforced.

Example manual PowerShell/curl request, after selecting the actual ready mission ID:

```powershell
$missionId = '<ready-subscription-mission-id>'
curl.exe --fail-with-body -sS -X POST `
  -H 'Origin: http://127.0.0.1:8765' `
  -H 'Content-Type: application/json' --data '{}' `
  'http://127.0.0.1:8765/api/subscription/preflight'

$runInstant = [DateTimeOffset]::UtcNow
$runPayload = @{
  usage_credits_disabled = $true
  checked_at = $runInstant.ToString('o')
  verification_note = 'Operator confirms this run based on Theo''s existing extra-usage-OFF assertion; no new billing-page observation.'
  no_new_after = $runInstant.AddMinutes(2).ToString('o')
  stop_at = $runInstant.AddMinutes(5).ToString('o')
} | ConvertTo-Json -Compress
$runPayload | curl.exe --fail-with-body -sS `
  -H 'Origin: http://127.0.0.1:8765' `
  -H 'Content-Type: application/json' --data-binary '@-' `
  "http://127.0.0.1:8765/api/subscription/missions/$missionId/run"
```

This example is documentation. Validation uses synthetic adapters; no Claude generation or account-setting change is performed by the staged patch.
