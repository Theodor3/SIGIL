import json,gzip
from datetime import date,datetime,timezone,timedelta
from types import SimpleNamespace
import pytest
from api.research import context_store as cs
from api.data.context import PipelineContext
from api.research.timing import prediction_decision,post_decision_window

def test_same_day_reruns_immutable_and_ambiguous(tmp_path,monkeypatch):
 monkeypatch.setattr(cs,'snapshot_dir',lambda:tmp_path)
 c=PipelineContext(as_of_date=date(2026,10,1));a=cs.save_context(c,run_id='first');original=a.read_bytes()
 c.macro={'new':1};b=cs.save_context(c,run_id='second')
 assert a!=b and a.read_bytes()==original
 assert cs.list_snapshot_dates()==[date(2026,10,1)]
 with pytest.raises(ValueError,match='Multiple'):cs.load_context(c.as_of_date)
 with pytest.raises(ValueError,match='ambiguous'):cs.context_receipt(c.as_of_date)
 assert cs.snapshot_metadata(a)['run_id']=='first'

def test_source_version_hash_and_legacy(tmp_path,monkeypatch):
 monkeypatch.setattr(cs,'snapshot_dir',lambda:tmp_path)
 c=PipelineContext(as_of_date=date(2026,10,1));p=cs.save_context(c)
 assert cs.load_context(c.as_of_date).as_of_date==c.as_of_date
 with gzip.open(p,'rt') as f:d=json.load(f)
 d['macro']={'tampered':1}
 with gzip.open(p,'wt') as f:json.dump(d,f)
 with pytest.raises(ValueError,match='hash'):cs.snapshot_metadata(p)
 p.unlink();legacy=tmp_path/'2026-10-01.json.gz'
 with gzip.open(legacy,'wt') as f:json.dump({'as_of_date':'2026-10-01'},f)
 assert cs.load_context(c.as_of_date).as_of_date==c.as_of_date
 assert cs.snapshot_metadata(legacy)['captured_at'] is None

def test_decision_receipt_unknown_and_after():
 assert prediction_decision(None) is None
 p={'_sigil_provenance':{'evaluation_protocol':'post_decision_daily_v1','decision_at':'2026-10-01T20:00:00+00:00','input_available_at':'2026-10-01T21:00:00+00:00','context_snapshot':{'context_sha256':'a'*64,'receipt_sha256':'b'*64,'captured_at':'2026-10-01T19:00:00+00:00'}}}
 assert prediction_decision(p) is None
 p['_sigil_provenance']['input_available_at']='2026-10-01T19:00:00+00:00';assert prediction_decision(p).tzinfo is not None
 p['_sigil_provenance']['decision_at']='2026-10-01T20:00:00';assert prediction_decision(p) is None

def test_after_close_and_ny_date():
 ds=[date(2026,10,d) for d in [1,2,5,6,7]];series=(ds,[1,10,12,15,20])
 w=post_decision_window(series,datetime.fromisoformat('2026-10-01T23:30:00+00:00'),5)
 assert w==(date(2026,10,2),date(2026,10,6),.5)
 # UTC midnight is still previous NY date; must not move window by UTC date.
 assert post_decision_window(series,datetime.fromisoformat('2026-10-02T00:30:00+00:00'),5)==w
 assert post_decision_window(series,datetime(2026,10,1),5) is None
 assert post_decision_window((ds,[1,float('nan'),12,15,20]),datetime.fromisoformat('2026-10-01T23:30:00+00:00'),5) is None

def test_requires_full_decision_horizon_and_completed_bars():
 ds=[date(2026,10,d) for d in [1,2,5,6,7]];decision=datetime.fromisoformat('2026-10-01T23:30:00+00:00')
 assert post_decision_window((ds,[1,10,12,15,20]),decision,5,completed_through=date(2026,10,5)) is None
 assert post_decision_window((ds,[1,10,12,15,20]),decision,5,completed_through=date(2026,10,6)) is not None

def test_provenance_hash_tamper_and_reference(tmp_path,monkeypatch):
 monkeypatch.setattr(cs,'snapshot_dir',lambda:tmp_path)
 p=cs.save_context(PipelineContext(as_of_date=date(2026,10,1)),run_id='run-a')
 reference=cs.snapshot_metadata(p);assert cs.verify_snapshot_reference(reference)
 bad=dict(reference,captured_at='2020-01-01T00:00:00+00:00');assert not cs.verify_snapshot_reference(bad)
 with gzip.open(p,'rt') as f:d=json.load(f)
 d['_snapshot']['captured_at']='2020-01-01T00:00:00+00:00'
 with gzip.open(p,'wt') as f:json.dump(d,f)
 with pytest.raises(ValueError,match='provenance'):cs.snapshot_metadata(p)
 assert not cs.verify_snapshot_reference(reference)

def test_missing_stock_endpoint_cannot_shorten_calendar_window():
 decision=datetime.fromisoformat('2026-01-01T22:00:00+00:00')
 calendar=[date(2026,1,d) for d in [2,5,6,7,8,9,12,13,14,15,16,20,21]]
 short=calendar[:-2]
 assert post_decision_window((short,[100]*len(short)),decision,20,completed_through=date(2026,1,22),calendar_dates=calendar) is None
 assert post_decision_window((calendar,[100]*len(calendar)),decision,20,completed_through=date(2026,1,22),calendar_dates=calendar) is not None

def test_truncated_benchmark_cannot_confirm_target_endpoint():
 decision=datetime.fromisoformat('2026-01-01T22:00:00+00:00')
 dates=[date(2026,1,d) for d in [2,5,6,7,8,9,12,13,14,15,16]]
 assert post_decision_window((dates,[100]*len(dates)),decision,20,completed_through=date(2026,1,22),calendar_dates=dates) is None
