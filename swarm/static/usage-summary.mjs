// Display-only projection. Never dispatches work, reads credentials or changes a budget.
export const MAX_PAYLOAD_BYTES = 262144;
const amount = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
const stamp = x => typeof x === 'string' && /Z$|[+-]\d\d:\d\d$/.test(x) && Number.isFinite(Date.parse(x)) ? new Date(x).toISOString() : null;
function windowProjection(value) {
  const used = amount(value?.used_percentage);
  const reset = value?.resets_at;
  if (used === null || used > 100 || !Number.isSafeInteger(reset) || reset <= 0 || reset > 253402300799) return null;
  return {used_percentage: used, remaining_percentage: 100 - used, resets_at: new Date(reset * 1000).toISOString()};
}
export function projectClaudeStatusline(payload, observedAt = new Date().toISOString()) {
  const observed_at = stamp(observedAt);
  if (!observed_at) throw new Error('Invalid observation timestamp');
  return {schema_version: 1, source: 'claude_code_statusline', observed_at,
    five_hour: windowProjection(payload?.rate_limits?.five_hour),
    seven_day: windowProjection(payload?.rate_limits?.seven_day)};
}
export function parseClaudeStatusline(text, observedAt) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_PAYLOAD_BYTES) throw new Error('Invalid statusline payload');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid statusline payload'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid statusline payload');
  return projectClaudeStatusline(value, observedAt);
}
export function usageSummary(state, claude = null, now = new Date().toISOString()) {
  const timestamp = stamp(now);
  if (!timestamp) throw new Error('Invalid report timestamp');
  const observation = stamp(claude?.observed_at);
  const age = observation ? Date.parse(timestamp) - Date.parse(observation) : Infinity;
  const fresh = claude?.source === 'claude_code_statusline' && age >= 0 && age <= 300000;
  function quota(value) {
    const reset = stamp(value?.resets_at);
    const used = amount(value?.used_percentage);
    if (!fresh || used === null || used > 100 || !reset || Date.parse(reset) <= Date.parse(timestamp)) return null;
    return {used_percentage: used, remaining_percentage: 100 - used, resets_at: reset};
  }
  const byProvider = state?.budget?.by_provider ?? {};
  return {schema_version: 1, observed_at: timestamp,
    api: {scope: 'this_swarm_only', kind: 'estimate', actual_billed_usd: null,
      actual_billing_status: 'not_connected', uncertain: state?.budget?.uncertain === true,
      providers: Object.fromEntries(['openai', 'gemini'].map(provider => [provider, {
        today_estimated_usd: amount(byProvider[provider]?.today_usd),
        lifetime_estimated_usd: amount(byProvider[provider]?.pilot_usd)}]))},
    claude: {source: 'claude_code_statusline', observation_status: fresh ? 'recent_observation' : observation ? 'stale_or_invalid' : 'not_observed',
      observed_at: observation, five_hour: quota(claude?.five_hour), seven_day: quota(claude?.seven_day),
      actual_billed_usd: null, note: 'Subscription quota is not API dollars, context utilization or dispatch authorization.'}};
}
