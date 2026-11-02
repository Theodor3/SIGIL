// Read-only projection of scheduler/queue observations; never authorization to dispatch.
const stamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export function activityView(data, receivedAt, {now=new Date().toISOString(),failed=false}={}) {
  const observed=stamp(receivedAt), current=stamp(now);
  const age=observed&&current ? Date.parse(current)-Date.parse(observed) : NaN;
  const valid=data&&typeof data==='object'&&!Array.isArray(data);
  const freshness=!valid?'unavailable':failed||!Number.isFinite(age)||age<0||age>300000?'stale':'recent';
  const flag=value=>typeof value==='boolean'?(value?'Enabled':'Off'):'Unknown';
  const queue=data?.queue;
  const expiry=stamp(queue?.expires_at);
  const sessionExpired=Boolean(expiry&&current&&Date.parse(expiry)<=Date.parse(current));
  const warnings=[];
  if(freshness!=='recent')warnings.push('Current activity is unknown. Retained observations do not prove work is stopped.');
  if(queue?.enabled===true&&!expiry)warnings.push('Queue is enabled but its session deadline is unverified.');
  if(queue?.enabled===true&&sessionExpired)warnings.push('Recorded queue deadline has passed; fresh runtime verification is needed.');
  return {freshness,received_at:observed,scheduler:flag(data?.scheduler_enabled),queue:flag(queue?.enabled),
    running:typeof queue?.running==='boolean'?(queue.running?'Running':'Not running'):'Unknown',
    deadline:expiry??'Unknown / no session deadline reported',
    warnings};
}
