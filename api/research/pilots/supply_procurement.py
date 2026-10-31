"""Current-state drug/procurement normalization, not historical event backdating."""
import json,math,hashlib
from pathlib import Path
from datetime import datetime
from .receipts import load,stamp,canonical,digest

def finite(x):return type(x) in (int,float) and math.isfinite(x)

def normalize(root,identity):
    m,raw=load(root,identity);d=json.loads(raw);items=d.get('results')
    if not isinstance(items,list):raise ValueError('Source results missing')
    rows=[];seen=set()
    for item in items:
        if not isinstance(item,dict):raise ValueError('Invalid source row')
        if m['source']=='fda':
            key=(item.get('package_ndc'),item.get('company_name'),item.get('presentation'))
            if not all(isinstance(v,str) and v for v in key):raise ValueError('Drug identity incomplete')
            initial=item.get('initial_posting_date');reported_date=None
            if initial:
                try:reported_date=datetime.strptime(initial,'%m/%d/%Y').date().isoformat()
                except (TypeError,ValueError):pass
            row=dict(product_ndc=key[0],manufacturer_reported=key[1],presentation=key[2],generic_name=item.get('generic_name'),status=item.get('status'),availability=item.get('availability'),reported_initial_posting_date=reported_date,reported_update_date=item.get('update_date'),recovery_text=item.get('related_info'),historical_onset_verified=False,resolution_time=None,capacity=None,issuer_id=None,mapping_status='unverified',right_censored=None,reported_resolved=str(item.get('status','')).lower()=='resolved',episode_status='ineligible_unknown_onset_and_resolution')
        else:
            key=item.get('generated_internal_id') or item.get('Award ID')
            if not isinstance(key,str) or not key:raise ValueError('Award identity missing')
            amount=item.get('Award Amount')
            if not finite(amount):raise ValueError('Award amount invalid')
            row=dict(award_id=key,reported_award_id=item.get('Award ID'),recipient_reported=item.get('Recipient Name'),agency_reported=item.get('Awarding Agency'),award_amount_current=amount,reported_start_date=item.get('Start Date'),reported_end_date=item.get('End Date'),issuer_id=None,mapping_status='unverified_requires_entity_and_historical_parent',issuer_feature_eligible=False,amount_kind='current_cumulative_award_snapshot_not_revenue_or_transaction_flow',contract_type=None)
        keyhash=digest(canonical(key))
        if keyhash in seen:raise ValueError('Duplicate identities require explicit source reconciliation')
        seen.add(keyhash)
        row.update(identity=keyhash,row_sha256=digest(canonical(item)),available_at=m['available_at'],receipt=identity,source_publication_at=None,evidence_kind=m['evidence_kind']);rows.append(row)
    return dict(normalizer_version='pilot-1',normalizer_code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),source=m['source'],receipt=identity,evidence_kind=m['evidence_kind'],rows=rows,sample_count=len(rows),coverage='bounded_first_page_not_full_population',total_reported=d.get('meta',{}).get('results',{}).get('total'),more_pages=d.get('page_metadata',{}).get('hasNext'),historical_backtest_eligible=False)

def observed_changes(root,older,newer):
    a=normalize(root,older);b=normalize(root,newer)
    if a['source']!=b['source']:raise ValueError('Different sources')
    ma,_=load(root,older);mb,_=load(root,newer)
    if stamp(mb['received_at'])<=stamp(ma['received_at']):raise ValueError('Version order required')
    before={r['identity']:r for r in a['rows']};after={r['identity']:r for r in b['rows']}
    return dict(changed=[k for k in before.keys()&after.keys() if before[k]['row_sha256']!=after[k]['row_sha256']],newly_observed=list(after.keys()-before.keys()),absent_from_sample_not_resolved=list(before.keys()-after.keys()),meaning='observed_current_state_versions_not_original_event_dates')

def duration_baseline(episodes,decision_at,horizon_days=30):
    """Kaplan-Meier baseline; trusted episode labels require onset and receipt evidence."""
    if type(horizon_days) is not int or not 0<=horizon_days<=3650:raise ValueError('Bounded nonnegative horizon required')
    cutoff=stamp(decision_at);valid=[];kinds=set()
    for e in episodes:
        if e.get('onset_verified') is not True or stamp(e['outcome_available_at'])>=cutoff:continue
        onset=stamp(e['onset_at']);followup=stamp(e['followup_at'])
        if onset>followup or followup>stamp(e['outcome_available_at']) or stamp(e['onset_available_at'])>=cutoff:raise ValueError('Invalid episode availability')
        measured=(followup-onset).total_seconds()/86400
        if not finite(e.get('duration_days')) or e['duration_days']<0 or type(e.get('event_observed')) is not bool:raise ValueError('Invalid episode')
        if e.get('evidence_kind') not in ('synthetic_fixture','verified_point_in_time_labels'):raise ValueError('Episode evidence kind required')
        if not math.isclose(e['duration_days'],measured,abs_tol=1e-8):raise ValueError('Duration does not match episode times')
        kinds.add(e['evidence_kind']);valid.append(e)
    if not valid:return {'status':'blocked_no_verified_available_episodes','survival_probability':None,'n':0,'input_n':len(episodes),'excluded_n':len(episodes),'evidence_kind':None}
    if len(kinds)!=1:raise ValueError('Do not mix fixture and real episode evidence')
    risk=len(valid);survival=1.
    for t in sorted({e['duration_days'] for e in valid if e['duration_days']<=horizon_days}):
        group=[e for e in valid if e['duration_days']==t];deaths=sum(e['event_observed'] for e in group)
        survival*=1-deaths/risk;risk-=len(group)
    support=max(e['duration_days'] for e in valid)
    supported=horizon_days<=support or survival==0
    return dict(status='baseline_only_not_trading' if supported else 'unsupported_horizon',n=len(valid),input_n=len(episodes),excluded_n=len(episodes)-len(valid),horizon_days=horizon_days,maximum_followup_days=support,training_sha256=digest(canonical(valid)),at_risk_after_horizon=risk,evidence_kind=next(iter(kinds)),survival_probability=survival if supported else None)

def conversion_baseline(training,decision_at):
    """Stratified historical conversion ratio; current award totals never substitute flows."""
    cutoff=stamp(decision_at);groups={};kinds=set();used=[]
    for row in training:
        if row.get('mapping_verified') is not True or row.get('matched_revenue_verified') is not True:continue
        if row.get('input_kind')!='incremental_funded_obligation':continue
        if stamp(row['input_available_at'])>=cutoff or stamp(row['label_available_at'])>=cutoff:continue
        amount,revenue=row.get('funded_obligation'),row.get('matched_revenue')
        if not finite(amount) or amount<=0 or not finite(revenue) or revenue<0:raise ValueError('Invalid conversion label')
        key=(row['issuer_id'],row['customer'],row['contract_type'])
        if not all(isinstance(v,str) and v for v in key):raise ValueError('Contract/customer strata missing')
        if row.get('evidence_kind') not in ('synthetic_fixture','verified_point_in_time_labels'):raise ValueError('Conversion evidence kind required')
        kinds.add(row['evidence_kind']);used.append(row);groups.setdefault(key,[]).append(revenue/amount)
    if len(kinds)>1:raise ValueError('Do not mix fixture and real conversion evidence')
    return dict(input_n=len(training),eligible_n=len(used),excluded_n=len(training)-len(used),training_sha256=digest(canonical(used)),evidence_kind=next(iter(kinds)) if kinds else None,status='blocked_no_verified_conversion_labels' if not groups else 'stratified_baseline_only',groups=[dict(issuer_id=k[0],customer=k[1],contract_type=k[2],n=len(v),mean_ratio=sum(v)/len(v)) for k,v in groups.items()])

def observed_panel(root,source):
    """Retained local observation history; never a reconstructed public-event history."""
    from pathlib import Path
    import re
    paths=[p for p in Path(root).glob('*.json') if re.fullmatch(r'[a-f0-9]{64}\.json',p.name)]
    if len(paths)>500:raise ValueError('Explicit batch selection required above500receipts')
    versions=[];kinds=set()
    for p in paths:
        m,_=load(root,p.stem)
        if m['source']!=source:continue
        versions.append(normalize(root,p.stem));kinds.add(m['evidence_kind'])
    if len(kinds)>1:raise ValueError('Do not combine fixture and real observation panels')
    rows=[r for v in versions for r in v['rows']];first={}
    for row in rows:
        key=row['identity'];t=row['available_at']
        if key not in first or stamp(t)<stamp(first[key]):first[key]=t
    rows=[dict(row,first_observed_locally_at=first[row['identity']]) for row in rows]
    rows.sort(key=lambda x:(stamp(x['available_at']),x['identity']))
    return dict(source=source,receipt_count=len(versions),distinct_identities=len(first),version_observations=rows,evidence_kind=next(iter(kinds)) if kinds else None,historical_public_availability_verified=False)

