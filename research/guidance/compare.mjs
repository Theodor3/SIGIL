// Pure evidence comparison. This module cannot make an event tradable.
const dimensions = ['issuer', 'fiscalStart', 'fiscalEnd', 'metric', 'currency', 'basis', 'unit', 'scope'];
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value;
}
// Use exact decimal values of the supplied finite numeric labels. This prevents
// binary subtraction noise turning equal quoted widths into research events.
export function rangeMetrics(priorLow, priorHigh, currentLow, currentHigh) {
  const values=[priorLow,priorHigh,currentLow,currentHigh];
  if(!values.every(Number.isFinite) || priorLow>priorHigh || currentLow>currentHigh) throw new Error('Invalid numeric range');
  const decimal=value=>{
    const [mantissa, exponent='0']=String(value).toLowerCase().split('e');
    return {coefficient:BigInt(mantissa.replace('.','')),scale:(mantissa.split('.')[1]?.length??0)-Number(exponent)};
  };
  const parts=values.map(decimal),scale=Math.max(0,...parts.map(p=>p.scale));
  const [al,ah,bl,bh]=parts.map(p=>p.coefficient*10n**BigInt(scale-p.scale));
  const asNumber=(value,digits=scale)=>{
    const sign=value<0n?'-':'',text=(value<0n?-value:value).toString().padStart(digits+1,'0');
    const result=Number(sign+(digits?`${text.slice(0,-digits)}.${text.slice(-digits)}`:text));
    if(!Number.isFinite(result)) throw new Error('Derived arithmetic overflow');
    return result;
  };
  const aw=ah-al,bw=bh-bl,change=bw-aw;
  return {lowChange:asNumber(bl-al),highChange:asNumber(bh-ah),
    priorMidpoint:asNumber((al+ah)*5n,scale+1),currentMidpoint:asNumber((bl+bh)*5n,scale+1),
    midpointChange:asNumber((bl+bh-al-ah)*5n,scale+1),priorWidth:asNumber(aw),currentWidth:asNumber(bw),
    widthChange:asNumber(change),widthClassification:change<0n?'narrowed':change>0n?'widened':'unchanged'};
}
export function compareGuidance(prior, current) {
  const reject = reason => ({ classification: 'noncomparable', reason, eligibleForReturns: false });
  if (!prior || !current) return reject('missing_disclosure');
  for (const key of dimensions) {
    if (typeof prior[key] !== 'string' || !prior[key].trim() || typeof current[key] !== 'string' || !current[key].trim()) return reject(`missing_${key}`);
    if (prior[key] !== current[key]) return reject(`different_${key}`);
  }
  for (const d of [prior, current]) {
    if (!Number.isFinite(d.low) || !Number.isFinite(d.high) || d.low > d.high) return reject('invalid_or_qualitative_range');
    if (!validDay(d.fiscalStart) || !validDay(d.fiscalEnd) || d.fiscalStart >= d.fiscalEnd) return reject('invalid_fiscal_period');
  }
  let metrics;
  try {metrics=rangeMetrics(prior.low,prior.high,current.low,current.high);} catch {return reject('derived_arithmetic_overflow');}
  const {lowChange,highChange,priorMidpoint,midpointChange}=metrics;
  const classification = lowChange === 0 && highChange === 0 ? 'unchanged'
    : lowChange >= 0 && highChange >= 0 ? 'raised'
    : lowChange <= 0 && highChange <= 0 ? 'cut' : 'mixed';
  return { classification,...metrics,
    widthChangeUnit: prior.unit === 'growth_percent' ? 'percentage_points' : prior.unit,
    midpointChangeUnit: prior.unit === 'growth_percent' ? 'percentage_points' : prior.unit,
    relativeMidpointChange: prior.unit !== 'growth_percent' && priorMidpoint > 0 ? midpointChange / priorMidpoint : null,
    eligibleForReturns: false,
    reason: 'numeric_comparison_only_latest_prior_and_historical_availability_require_review' };
}
