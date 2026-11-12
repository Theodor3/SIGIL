from datetime import datetime,timedelta,timezone
import pytest,json
from swarm import claude_code as cc
from swarm.tests.test_claude_code import Finding,MODEL,response

def test_no_implicit_renewal():
 assert cc.mission_window(None)==(cc.NO_NEW_AFTER,cc.STOP_AT)

@pytest.mark.parametrize('kind',['naive','reverse','past','long','list','bad'])
def test_bad_windows(kind):
 n=datetime.now(timezone.utc);a=n+timedelta(minutes=1);b=n+timedelta(minutes=3)
 w={'naive':(a.replace(tzinfo=None),b),'reverse':(b,a),'past':(n-timedelta(seconds=1),b),'long':(a,n+timedelta(minutes=31)),'list':[a,b],'bad':('x',b)}[kind]
 with pytest.raises(cc.ClaudeCodeBlocked):cc.mission_window(w,n)

def test_explicit_window_propagated_not_persisted(tmp_path,monkeypatch):
 calls=[];monkeypatch.setattr(cc,'check_managed_policy',lambda:None)
 def fake(args,**kwargs):
  calls.append((args,kwargs))
  if '--version' in args:return cc.VERSION
  if 'auth' in args:return json.dumps(dict(loggedIn=True,authMethod='claude.ai',apiProvider='firstParty',subscriptionType='pro'))
  return json.dumps(response())
 monkeypatch.setattr(cc,'bounded_process',fake)
 n=datetime.now(timezone.utc);window=(n+timedelta(minutes=2),n+timedelta(minutes=4))
 result=cc.ClaudeCodeAdapter('/fixture',tmp_path/'lock').run({},'Review',Finding,model=MODEL,extra_usage_disabled_confirmed=True,max_turns=8,dispatch_window=window)
 assert len(calls)==3 and all(k['stop_at']==window[1] for _,k in calls)
 assert result['dispatch_window']['stop_at']==window[1].isoformat()
 assert cc.mission_window(None)[1]==cc.STOP_AT
 assert all('ANTHROPIC_API_KEY' not in k['env'] for _,k in calls)
 assert calls[-1][0][calls[-1][0].index('--tools')+1]==''

def test_expired_hard_stop_never_creates_process(tmp_path,monkeypatch):
 monkeypatch.setattr(cc.subprocess,'Popen',lambda *a,**k:pytest.fail('Expired process launched'))
 with pytest.raises(cc.ClaudeCodeBlocked,match='cutoff'):
  cc.bounded_process(['fixture'],env={},cwd=tmp_path,stop_at=datetime.now(timezone.utc)-timedelta(seconds=1))

def test_expired_launch_never_creates_process(tmp_path,monkeypatch):
 monkeypatch.setattr(cc.subprocess,'Popen',lambda *a,**k:pytest.fail('Expired process launched'))
 n=datetime.now(timezone.utc)
 with pytest.raises(cc.ClaudeCodeBlocked,match='cutoff'):
  cc.bounded_process(['fixture'],env={},cwd=tmp_path,stop_at=n+timedelta(minutes=1),no_new_after=n-timedelta(seconds=1))

def test_callback_cannot_cross_launch_cutoff(tmp_path,monkeypatch):
 calls=[];monkeypatch.setattr(cc,'check_managed_policy',lambda:None)
 def fake(args,**kwargs):
  calls.append(args)
  if '--version' in args:return cc.VERSION
  if 'auth' in args:return json.dumps(dict(loggedIn=True,authMethod='claude.ai',apiProvider='firstParty',subscriptionType='pro'))
  pytest.fail('Generation launched after callback expiry')
 monkeypatch.setattr(cc,'bounded_process',fake)
 n=datetime.now(timezone.utc);window=(n+timedelta(minutes=1),n+timedelta(minutes=2))
 class Late(datetime):
  @classmethod
  def now(cls,tz=None):return window[0]+timedelta(seconds=1)
 def progress(phase):
  if phase=='generation_launch':monkeypatch.setattr(cc,'datetime',Late)
 with pytest.raises(cc.ClaudeCodeBlocked,match='cutoff'):
  cc.ClaudeCodeAdapter('/fixture',tmp_path/'lock').run({},'Review',Finding,model=MODEL,extra_usage_disabled_confirmed=True,dispatch_window=window,progress=progress)
 assert len(calls)==2
