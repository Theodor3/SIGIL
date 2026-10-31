"""Pure daily-close timing rules; directional outcomes, never executable fills."""
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
from bisect import bisect_left,bisect_right
import math
import re

def aware_time(value):
    if not isinstance(value,str):raise ValueError('Unknown timestamp')
    stamp=datetime.fromisoformat(value)
    if stamp.tzinfo is None or stamp.utcoffset() is None:raise ValueError('Timezone required')
    return stamp.astimezone(timezone.utc)

def prediction_decision(metadata,run_id=None):
    try:
        p=metadata['_sigil_provenance']
        if p['evaluation_protocol']!='post_decision_daily_v1':return None
        decision=aware_time(p['decision_at']);available=aware_time(p['input_available_at'])
        reference=p['context_snapshot']
        if available>decision or reference['captured_at'] != p['input_available_at']:return None
        if run_id is not None and reference['run_id'] != run_id:return None
        if any(not isinstance(reference.get(k),str) or not re.fullmatch(r'[a-f0-9]{64}',reference[k]) for k in ['context_sha256','receipt_sha256']):return None
        return decision
    except (KeyError,TypeError,ValueError):return None

def completed_market_date(now=None):
    """Conservative complete-bar bound; do not assume today's close has settled."""
    return (now or datetime.now(timezone.utc)).astimezone(ZoneInfo('America/New_York')).date()-timedelta(days=1)

def post_decision_window(series,decision,horizon_days,*,completed_through=None,calendar_dates=None):
    """First close on a NY date strictly after decision; calendar horizon from that date."""
    if decision.tzinfo is None or decision.utcoffset() is None or type(horizon_days) is not int or horizon_days<=0:return None
    day=decision.astimezone(ZoneInfo('America/New_York')).date()
    complete = completed_through or completed_market_date()
    if day + timedelta(days=horizon_days) > complete:return None
    dates,prices=series
    if len(dates)!=len(prices) or any(a>=b for a,b in zip(dates,dates[1:])):return None
    if calendar_dates is not None:
        if not calendar_dates or any(a>=b for a,b in zip(calendar_dates,calendar_dates[1:])):return None
        if calendar_dates[-1] < day+timedelta(days=horizon_days):return None
        first=bisect_right(calendar_dates,day)
        last=bisect_right(calendar_dates,day+timedelta(days=horizon_days))-1
        if first>=len(calendar_dates) or last<=first:return None
        entry_day,exit_day=calendar_dates[first],calendar_dates[last]
        i=bisect_left(dates,entry_day);j=bisect_left(dates,exit_day)
        if i>=len(dates) or j>=len(dates) or dates[i]!=entry_day or dates[j]!=exit_day:return None
    else:
        i=bisect_right(dates,day)
        j=bisect_right(dates,day+timedelta(days=horizon_days))-1
        # Without an independent calendar, reject clearly stale endpoints.
        if j<0 or (day+timedelta(days=horizon_days)-dates[j]).days>3:return None
    if i>=len(dates) or j<=i or (dates[i]-day).days>5:return None
    if (day+timedelta(days=horizon_days)-dates[j]).days>3:return None
    if (dates[j]-dates[i]).days<max(2,int(horizon_days*.6)):return None
    if any(type(p) not in (int,float) or not math.isfinite(p) or p<=0 for p in (prices[i],prices[j])):return None
    return dates[i],dates[j],prices[j]/prices[i]-1
