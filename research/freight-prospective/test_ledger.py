import pytest,sqlite3,json
from datetime import datetime,timedelta,date,timezone
from ledger import Ledger,stamp,target,closure
F=stamp('2026-10-29T18:30:01Z');S=stamp('2026-10-29T18:30:00Z');P='a'*64
D={'operator':'NS','commodity':'Grain','column':'Originated','units':'carloads','sheet':'Carloadings (Item 11)','value_cell':'D16','period_cells':['E3','E4']}
def add(l,w,v,t='2026-10-28T18:00:00Z',suffix='',valid=True):
 r=l.capture('https://www.stb.gov/'+w,(w+suffix).encode(),t);l.register(r,w,v,valid,D);return r
@pytest.fixture
def l(tmp_path):return Ledger(tmp_path/'test.sqlite')
def seed(l):
 for i,w in enumerate(['2026-09-27','2026-10-04','2026-10-11','2026-10-18']):add(l,w,100+10*i)
def test_repeat_does_not_refresh(l):
 r=l.capture('https://www.stb.gov/a',b'a','2026-10-01T00:00:00Z');l.capture('https://www.stb.gov/a',b'a','2026-10-29T00:00:00Z');assert stamp(l.db.execute('SELECT first_seen FROM receipts WHERE id=?',(r,)).fetchone()[0])==stamp('2026-10-01T00:00:00Z')
def test_naive_rejected(l):
 with pytest.raises(ValueError):l.capture('u',b'a',datetime(2026,1,1))
def test_receipt_immutable(l):
 l.capture('u',b'a',F)
 with pytest.raises(sqlite3.IntegrityError):l.db.execute("UPDATE receipts SET url='x'")
def test_good_formula(l):
 seed(l);fid,b=l.issue(P,S,F);assert b['P']==115 and b['B']==130;assert b['target_start']=='2026-11-01T04:00:00.000000+00:00';assert len(b['inputs'])==4
@pytest.mark.parametrize('f,expected,hours',[('2026-03-08T04:59:00Z','2026-03-08T05:00:00.000000+00:00',167),('2026-11-01T03:59:00Z','2026-11-01T04:00:00.000000+00:00',169),('2026-11-01T04:00:00Z','2026-11-08T05:00:00.000000+00:00',168)])
def test_dst_and_strict_target(f,expected,hours):
 a,b=target(f);assert a==expected;assert (stamp(b)-stamp(a)).total_seconds()/3600==hours
def test_duplicate_forecast(l):
 seed(l);l.issue(P,S,F)
 with pytest.raises(sqlite3.IntegrityError):l.issue(P,S,F+timedelta(seconds=1))
 assert l.db.execute('SELECT COUNT(*) FROM forecasts').fetchone()[0]==1
def test_missing_week(l):
 seed(l);l.db.close()
 # Separate ledger with only three genuine native weeks.
 m=Ledger(':memory:')
 for w in ['2026-10-04','2026-10-11','2026-10-18']:add(m,w,1)
 with pytest.raises(ValueError,match='consecutive'):m.issue(P,S,F)
def test_invalid_latest_no_fallback(l):
 seed(l);add(l,'2026-10-18',None,'2026-10-29T17:00:00Z','bad',False)
 with pytest.raises(ValueError,match='invalid'):l.issue(P,S,F)
def test_future_revision_excluded(l):
 seed(l);add(l,'2026-10-18',999,'2026-10-30T17:00:00Z','future');assert l.issue(P,S,F)[1]['B']==130
def test_stale_receipt(l):
 for w in ['2026-09-27','2026-10-04','2026-10-11','2026-10-18']:add(l,w,1,'2026-10-20T00:00:00Z')
 with pytest.raises(ValueError,match='Stale'):l.issue(P,S,F)
def test_stale_period(l):
 for w in ['2026-09-06','2026-09-13','2026-09-20','2026-09-27']:add(l,w,1)
 with pytest.raises(ValueError,match='Stale'):l.issue(P,S,F)
def test_unknown_period_blocks(l):
 seed(l);r=l.capture('unknown',b'unknown',F);l.register(r,None,None,False,{'reason':'ambiguous'})
 with pytest.raises(ValueError,match='Unassigned'):l.issue(P,S,F)
def test_wrong_identity(l):
 r=l.capture('u',b'a',F)
 with pytest.raises(ValueError):l.register(r,'2026-10-18',5,True,{**D,'operator':'CSXT'})
def test_slot_skip(l):
 seed(l)
 with pytest.raises(ValueError,match='slot'):l.issue(P,S,S+timedelta(minutes=15))
def test_zero_actual_scores(l):
 seed(l);fid,b=l.issue(P,S,F);add(l,'2026-11-01',0,'2026-11-09T18:00:00Z');o=l.finalize(fid,'2026-12-07T05:00:00Z');assert o['Y']==0;sc=l.score(P);assert sc['development']['mae_P']==115 and sc['development']['mae_B']==130
 with pytest.raises(sqlite3.IntegrityError):l.finalize(fid,'2026-12-08T05:00:00Z')
def test_late_outcome_missing(l):
 seed(l);fid,b=l.issue(P,S,F);add(l,'2026-11-01',3,'2026-12-07T05:00:01Z');assert l.finalize(fid,'2026-12-08T05:00:00Z')['status']=='missing';assert l.score(P)['missing']==1

def test_revision_does_not_replace_primary(l):
 seed(l);fid,b=l.issue(P,S,F);add(l,'2026-11-01',120,'2026-11-09T18:00:00Z');add(l,'2026-11-01',999,'2026-11-10T18:00:00Z','revision');assert l.finalize(fid,'2026-12-07T05:00:00Z')['Y']==120

def test_early_finalize_rejected(l):
 seed(l);fid,b=l.issue(P,S,F)
 with pytest.raises(ValueError,match='deadline'):l.finalize(fid,'2026-11-10T00:00:00Z')


def test_unregistered_receipt_blocks(l):
 seed(l);l.capture('potentialrevision',b'unparsed',F)
 with pytest.raises(ValueError,match='Unassigned'):l.issue(P,S,F)
 assert l.db.execute("SELECT COUNT(*) FROM attempts WHERE status='skipped'").fetchone()[0]==1

def test_scoring_partitions_and_no_future_peeking(l):
 for i in range(53):
  f={'P':i+1,'B':i+2};fid=str(i)
  with l.db:
   l.db.execute('INSERT INTO forecasts VALUES(?,?,?,?,?,?)',(fid,P,str(i),str(i).zfill(3),'end',json.dumps(f)))
   l.db.execute('INSERT INTO outcomes VALUES(?,?)',(fid,json.dumps({'status':'scored','Y':i})))
 sc=l.score(P);assert sc['scored']==53
 assert sc['development']['n']==26 and sc['evaluation']['n']==26
 assert sc['development']['feasible'] and sc['evaluation']['feasible']
 assert sc['evaluation']['mae_P']==1 and sc['evaluation']['mae_B']==2
 assert sc['evaluation']['mae_difference_P_minus_B']==-1

def test_pending_earlier_blocks_later_scoring(l):
 for i in range(2):
  with l.db:l.db.execute('INSERT INTO forecasts VALUES(?,?,?,?,?,?)',(str(i),P,str(i),str(i),'end','{}'))
 with l.db:l.db.execute('INSERT INTO outcomes VALUES(?,?)',('1',json.dumps({'status':'missing'})))
 with pytest.raises(ValueError,match='Earlier'):l.score(P)

def test_unparsed_outcome_cannot_finalize_missing(l):
 seed(l);fid,b=l.issue(P,S,F);l.capture('newoutcome',b'unparsed-outcome','2026-11-09T18:00:00Z')
 with pytest.raises(ValueError,match='Unparsed'):l.finalize(fid,'2026-12-07T05:00:00Z')
 assert l.db.execute('SELECT COUNT(*) FROM outcomes').fetchone()[0]==0

def test_reversed_receipt_clock_rejected(l):
 l.capture('u',b'a','2026-10-28T00:00:00Z')
 with pytest.raises(ValueError,match='clock'):l.capture('u',b'a','2026-10-27T00:00:00Z')

def test_failed_success_audit_rolls_back_forecast(l):
 seed(l)
 l.db.execute("CREATE TRIGGER fail_issued BEFORE INSERT ON attempts WHEN NEW.status='issued' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END")
 with pytest.raises(sqlite3.IntegrityError,match='fixture'):l.issue(P,S,F)
 assert l.db.execute('SELECT COUNT(*) FROM forecasts').fetchone()[0]==0
 assert l.db.execute("SELECT COUNT(*) FROM attempts WHERE status='skipped'").fetchone()[0]==1
