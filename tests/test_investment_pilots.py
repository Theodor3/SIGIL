import copy,json,math
from datetime import datetime,timezone
import pytest
from api.research.pilots import receipts as r
from api.research.pilots.supply_procurement import normalize,observed_changes,duration_baseline,conversion_baseline
from api.research.pilots.location import location_baselines

A='2026-10-30T19:00:00+00:00';B='2026-10-30T19:00:01+00:00'
def drug(**changes):
 x=dict(package_ndc='0001-002-03',company_name='Fixture Pharma',presentation='Fixture drug 1mg',status='Current',availability='Available',initial_posting_date='01/01/2020');x.update(changes);return x

def put(tmp_path,items,source='fda',a=A,b=B):
 return r.store(tmp_path,source,json.dumps({'results':items}).encode(),requested_at=a,received_at=b,request_body=r.PROCUREMENT_QUERY if source=='procurement' else None,fixture=True)

def test_immutable_idempotent_receipts_and_tamper(tmp_path):
 x=put(tmp_path,[drug()]);assert put(tmp_path,[drug()])==x
 meta,body=r.load(tmp_path,x);assert meta['source_publication_at'] is None and meta['available_at']==B and meta['evidence_kind']=='synthetic_fixture'
 (tmp_path/(x+'.bin')).write_bytes(body+b' ')
 with pytest.raises(ValueError,match='integrity'):r.load(tmp_path,x)

@pytest.mark.parametrize('identity',['../secret','g'*64,'a'*63])
def test_receipt_path_closed(tmp_path,identity):
 with pytest.raises(ValueError):r.load(tmp_path,identity)

def test_unknown_source_query_and_time_closed(tmp_path):
 for source,body,a,b in [('private',None,A,B),('fda',{'api_key':'fixture'},A,B),('fda',None,B,A),('fda',None,A,'2026-10-30T19:00:00')]:
  with pytest.raises(ValueError):r.store(tmp_path,source,b'{}',requested_at=a,received_at=b,request_body=body,fixture=True)

def test_drug_fields_not_inferred_and_partial_absence_not_resolution(tmp_path):
 a=put(tmp_path,[drug()]);d=normalize(tmp_path,a);x=d['rows'][0]
 assert x['status']=='Current' and x['availability']=='Available'
 assert x['reported_initial_posting_date']=='2020-01-01' and x['available_at']==B
 assert x['resolution_time'] is None and x['capacity'] is None and not d['historical_backtest_eligible']
 b=put(tmp_path,[],a='2026-10-31T19:00:00+00:00',b='2026-10-31T19:00:01+00:00')
 delta=observed_changes(tmp_path,a,b);assert delta['absent_from_sample_not_resolved']==[x['identity']]

def test_changed_payload_new_version(tmp_path):
 a=put(tmp_path,[drug()]);b=put(tmp_path,[drug(availability='Limited Availability')],a='2026-10-31T19:00:00+00:00',b='2026-10-31T19:00:01+00:00')
 assert a!=b and len(observed_changes(tmp_path,a,b)['changed'])==1

def test_procurement_mapping_and_amount_gate(tmp_path):
 rows=[{'Award ID':'fixture-1','Recipient Name':'ICF NAMED FIXTURE','Award Amount':100.}, {'Award ID':'fixture-2','Recipient Name':'UNRELATED FIXTURE','Award Amount':300.}]
 d=normalize(tmp_path,put(tmp_path,rows,'procurement'))
 assert all(not x['issuer_feature_eligible'] and x['issuer_id'] is None for x in d['rows'])
 assert all('not_revenue' in x['amount_kind'] for x in d['rows'])
 assert conversion_baseline(d['rows'],B)['status'].startswith('blocked')
 with pytest.raises(ValueError):normalize(tmp_path,put(tmp_path,[dict(rows[0],**{'Award Amount':True})],'procurement'))

def test_duration_censoring_and_future_label_gate():
 rows=[dict(onset_verified=True,outcome_available_at=A,duration_days=10,event_observed=True,evidence_kind='synthetic_fixture'),dict(onset_verified=True,outcome_available_at=A,duration_days=20,event_observed=False,evidence_kind='synthetic_fixture'),dict(onset_verified=True,outcome_available_at='2027-01-01T00:00:00+00:00',duration_days=1,event_observed=True,evidence_kind='synthetic_fixture')]
 for e in rows:
  e.update(onset_at='2026-10-01T00:00:00+00:00',followup_at={10:'2026-10-11',20:'2026-10-21',1:'2026-10-02'}[e['duration_days']]+'T00:00:00+00:00',onset_available_at='2026-10-01T01:00:00+00:00')
 out=duration_baseline(rows,B,15);assert out['n']==2 and out['survival_probability']==.5
 assert duration_baseline(rows,B,30)['status']=='unsupported_horizon' and duration_baseline(rows,B,30)['survival_probability'] is None
 assert duration_baseline([],B)['survival_probability'] is None

def test_conversion_requires_actual_incremental_flow_and_labels():
 row=dict(mapping_verified=True,matched_revenue_verified=True,input_kind='incremental_funded_obligation',input_available_at=A,label_available_at=A,funded_obligation=100,matched_revenue=50,issuer_id='FIXTURE',customer='fixture',contract_type='fixed_price',evidence_kind='synthetic_fixture')
 assert conversion_baseline([row],B)['groups'][0]['mean_ratio']==.5
 row['input_kind']='current_cumulative_award_snapshot_not_revenue_or_transaction_flow';assert not conversion_baseline([row],B)['groups']

def packet():
 rows=[]
 for month in range(1,13):
  nxt=f'2024-{month+1:02}-01' if month<12 else '2025-01-01'
  rows.append(dict(unit_id='fixture-zone',period_end=f'2024-{month:02}-28',features_available_at=f'2024-{month:02}-01T00:00:00+00:00',forecast_decision_at=f'2024-{month:02}-02T00:00:00+00:00',label_available_at=nxt+'T00:00:00+00:00',feature_names=['fixed_feature'],features=[month],label=2*month+5,evidence_kind='synthetic_fixture'))
 target=dict(unit_id='fixture-zone',period_end='2026-01-28',features_available_at='2026-01-01T00:00:00+00:00',feature_names=['fixed_feature'],features=[13],evidence_kind='synthetic_fixture')
 for item in rows+[target]:item.update(label_definition='fixture_monthly_visits',label_unit='fixture_count',geography_version='fixture_geo1',membership_version='fixture_cohort1')
 return rows,target,'2026-01-02T00:00:00+00:00'

def test_location_baselines_precede_lstm_and_train_only_scaler():
 rows,target,decision=packet();out=location_baselines(rows,target,decision)
 assert out['n']==12 and out['evidence_kind']=='synthetic_fixture' and out['model']['means']==[6.5]
 assert out['persistence']==29 and out['seasonal']==7 and math.isfinite(out['linear']) and out['lstm']=='not_fit'
 target['label']=999999;assert location_baselines(rows,target,decision)['model_sha256']==out['model_sha256']

def test_future_label_unavailable_cannot_change_fit():
 rows,target,decision=packet();rows[-1]['label_available_at']='2027-01-01T00:00:00+00:00'
 a=location_baselines(rows,target,decision);rows[-1]['label']=99999999;b=location_baselines(rows,target,decision)
 assert a==b and a['n']==11

def test_location_historical_future_features_rejected():
 rows,target,decision=packet();rows[0]['features_available_at']='2024-02-01T00:00:00+00:00'
 with pytest.raises(ValueError,match='Historical'):location_baselines(rows,target,decision)

@pytest.mark.parametrize('change',[lambda x:x.update(features=[True]),lambda x:x.update(features_available_at='2026-01-03T00:00:00+00:00'),lambda x:x.update(period_end='2025-12-01')])
def test_invalid_target_abstains(change):
 rows,target,decision=packet();change(target)
 with pytest.raises(ValueError):location_baselines(rows,target,decision)

def test_location_no_labels_no_fitted_results():
 _,target,decision=packet();out=location_baselines([],target,decision)
 assert out['status']=='blocked_no_available_labels' and out['linear'] is None and out['lstm']=='not_fit'

def test_unknown_censoring_for_reported_resolved(tmp_path):
 d=normalize(tmp_path,put(tmp_path,[drug(status='Resolved')]))['rows'][0]
 assert d['reported_resolved'] is True and d['right_censored'] is None and d['resolution_time'] is None

def test_duration_fixture_kind_and_mixing():
 a=dict(onset_verified=True,outcome_available_at=A,duration_days=10,event_observed=True,evidence_kind='synthetic_fixture')
 a.update(onset_at='2026-10-01T00:00:00+00:00',followup_at='2026-10-11T00:00:00+00:00',onset_available_at='2026-10-01T01:00:00+00:00')
 assert duration_baseline([a],B,10)['evidence_kind']=='synthetic_fixture'
 b=dict(a,evidence_kind='verified_point_in_time_labels')
 with pytest.raises(ValueError,match='mix'):duration_baseline([a,b],B,10)

def test_observed_panel_first_seen_does_not_backdate_changed_values(tmp_path):
 from api.research.pilots.supply_procurement import observed_panel
 put(tmp_path,[drug()]);put(tmp_path,[drug(availability='Limited')],a='2026-10-31T19:00:00+00:00',b='2026-10-31T19:00:01+00:00')
 p=observed_panel(tmp_path,'fda');assert p['receipt_count']==2 and p['distinct_identities']==1
 assert p['version_observations'][1]['first_observed_locally_at']==B
 assert p['version_observations'][1]['available_at']=='2026-10-31T19:00:01+00:00'

def test_observed_panel_sorts_mixed_timezone_instants(tmp_path):
 from api.research.pilots.supply_procurement import observed_panel
 put(tmp_path,[drug()]);put(tmp_path,[drug(availability='Limited')],a='2026-10-30T20:29:00+02:00',b='2026-10-30T20:30:00+02:00')
 rows=observed_panel(tmp_path,'fda')['version_observations']
 assert rows[0]['available_at']=='2026-10-30T20:30:00+02:00'
 assert rows[1]['available_at']==B
