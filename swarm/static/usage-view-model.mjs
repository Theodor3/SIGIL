import {usageSummary} from './usage-summary.mjs';
const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null;
export const formatMoney = x => number(x) === null ? 'Unknown' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(x);
export function usageView(state, receivedAt, {now=new Date().toISOString(),failed=false,claudeObservation=null}={}) {
  const received = typeof receivedAt === 'string' ? Date.parse(receivedAt) : NaN;
  const age = Date.parse(now)-received;
  const valid = Boolean(state?.budget && typeof state.budget==='object' && !Array.isArray(state.budget));
  const summary = usageSummary(valid ? state : {},claudeObservation,now);
  const b = valid ? state.budget : {};
  return {freshness: !valid ? 'unavailable' : failed || !Number.isFinite(age) || age < 0 || age > 300000 ? 'stale' : 'recent',
    received_at: Number.isFinite(received) ? new Date(received).toISOString() : null,
    timezone: typeof b.timezone==='string' ? b.timezone : 'Unknown',
    summary, allowance: {limit:number(b.allowance?.limit_usd),used:number(b.allowance?.used_usd),remaining:number(b.allowance?.remaining_usd),reserved:number(b.allowance?.reserved_usd),
      historical:number(b.historical_spend_usd),lifetime:number(b.pilot_usd),has_allowance:Boolean(b.allowance),
      expiry:b.allowance ? b.allowance.expires_at===null ? 'No expiry; no automatic refill' : 'Expiry not verified in this view' : 'Allowance not available'},
    installed: state?.runtime?.subscription?.installed===true ? 'Installed (quota not verified)' : 'Installation not verified',
    uncertain:valid && b.uncertain===true};
}
