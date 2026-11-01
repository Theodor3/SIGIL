import copy,json,sqlite3,math
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from swarm.app import create_app
from swarm.store import Store,BudgetError

def prepared(tmp_path,monkeypatch):
 monkeypatch.setattr('swarm.store.local_day',lambda:'2026-10-27');monkeypatch.setattr('swarm.store.now',lambda:'2026-10-27T20:00:00+00:00')
 s=Store(tmp_path);s.renew_development_budget();m=s.create('Synthetic allowance test','live')['id'];c=s.reserve(m,'data','gemini','fixture',4.038829);s.settle(c,cost=4.038829)
 monkeypatch.setattr('swarm.store.local_day',lambda:'2026-10-29');monkeypatch.setattr('swarm.store.now',lambda:'2026-10-29T04:00:00+00:00')
 return s,m

def test_new20_preserves_old_calls_and_survives_noexpiry(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch);history=copy.deepcopy(s.ledger);identity=s.store_id
 try:
  assert s.budget()['expired'];b=s.authorize_research_allowance();assert b['allowance']['remaining_usd']==20;assert b['expires_on'] is None and not b['expired'];assert b['historical_spend_usd']==4.038829
  c=s.reserve(m,'data','gemini','fixture',12);s.settle(c,cost=11);assert s.authorize_research_allowance()['allowance']['remaining_usd']==9;assert s.ledger[:1]==history
 finally:s.close()
 monkeypatch.setattr('swarm.store.local_day',lambda:'2040-01-01');monkeypatch.setattr('swarm.store.now',lambda:'2040-01-01T00:00:00+00:00')
 s=Store(tmp_path)
 try:
  assert s.store_id==identity;assert not s.budget()['expired'];assert s.budget()['allowance']['remaining_usd']==9;assert s.budget()['pilot_usd']==15.038829
  events=[json.loads(r[0]) for r in s._db.execute('SELECT data_json FROM events')];assert sum(e['type']=='api_allowance_authorization' for e in events)==1
 finally:s.close()

def test_cap_reservations_and_refill_not_implicit(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch)
 try:
  s.authorize_research_allowance();a=s.reserve(m,'data','gemini','fixture',12);b=s.reserve(m,'data','openai','fixture',8)
  assert s.budget()['remaining_pilot_usd']==0
  with pytest.raises(BudgetError,match='exceed'):s.reserve(m,'data','gemini','fixture',.000001)
  s.settle(a,cost=12);s.settle(b,cost=8);assert s.authorize_research_allowance()['remaining_pilot_usd']==0
 finally:s.close()

def test_concurrent_reservations_share_one_cap(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch)
 try:
  s.authorize_research_allowance()
  def attempt(_):
   try:return s.reserve(m,'data','gemini','fixture',3)
   except BudgetError:return None
  with ThreadPoolExecutor(max_workers=10) as pool:ids=list(pool.map(attempt,range(10)))
  assert len([x for x in ids if x])==6;assert s.budget()['allowance']['reserved_usd']==18;assert s.budget()['remaining_pilot_usd']==2
 finally:s.close()

def test_activation_cannot_erase_outstanding_or_uncertain(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch)
 try:
  # Existing expired budget blocks a new reservation; use the valid historical fixture phase.
  monkeypatch.setattr('swarm.store.local_day',lambda:'2026-10-27');c=s.reserve(m,'data','gemini','fixture',1)
  with pytest.raises(BudgetError,match='outstanding'):s.authorize_research_allowance()
  s.settle(c)
  with pytest.raises(BudgetError,match='outstanding'):s.authorize_research_allowance()
 finally:s.close()

def test_restart_retains_uncertain_hold_and_blocks(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch);s.authorize_research_allowance();s.reserve(m,'data','gemini','fixture',5);s.close();s=Store(tmp_path)
 try:
  assert s.budget()['uncertain'];assert s.budget()['allowance']['remaining_usd']==15
  with pytest.raises(BudgetError,match='uncertain'):s.reserve(m,'data','gemini','fixture',1)
 finally:s.close()

@pytest.mark.parametrize('amount',[float('nan'),float('inf'),-1,0,True])
def test_invalid_reservations_fail_closed(tmp_path,monkeypatch,amount):
 s,m=prepared(tmp_path,monkeypatch)
 try:
  s.authorize_research_allowance()
  with pytest.raises(BudgetError):s.reserve(m,'data','gemini','fixture',amount)
  assert s.budget()['allowance']['remaining_usd']==20
 finally:s.close()

def test_overrun_retained_and_stops_new_spend(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch)
 try:
  s.authorize_research_allowance();c=s.reserve(m,'data','gemini','fixture',20);s.settle(c,cost=21)
  assert s.budget()['uncertain'] and s.budget()['remaining_pilot_usd']==0
  with pytest.raises(BudgetError):s.reserve(m,'data','gemini','fixture',.01)
 finally:s.close()

def test_activation_write_failure_rolls_back(tmp_path,monkeypatch):
 s,m=prepared(tmp_path,monkeypatch)
 try:
  s._db.execute("CREATE TRIGGER fail_auth BEFORE UPDATE ON metadata WHEN NEW.key='pilot_settings' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END")
  with pytest.raises(sqlite3.IntegrityError):s.authorize_research_allowance()
  assert 'api_allowance' not in s.settings
  assert not any(json.loads(r[0])['type']=='api_allowance_authorization' for r in s._db.execute('SELECT data_json FROM events'))
 finally:s.close()

def test_endpoint_origin_idle_and_fixed_allowance(tmp_path,monkeypatch):
 app=create_app(tmp_path)
 with TestClient(app) as client:
  route='/api/budget/authorize-research-allowance';headers={'Origin':'http://testserver','Content-Type':'application/json'}
  assert client.post(route,headers={'Origin':'https://untrusted.example'},json={}).status_code==403
  app.state.engine.active_id='fixture';assert client.post(route,headers=headers,json={}).status_code==400;app.state.engine.active_id=None
  assert client.post(route,headers=headers,json={'limit_usd':200}).status_code==422
  r=client.post(route,headers=headers,json={});r.raise_for_status();assert r.json()['allowance']['limit_usd']==20 and r.json()['allowance']['expires_at'] is None
  assert client.get('/api/state').json()['active_mission_id'] is None


def test_microdollar_ceiling_cannot_cross_cap(tmp_path, monkeypatch):
    store, mission = prepared(tmp_path, monkeypatch)
    try:
        store.authorize_research_allowance()
        first = store.reserve(mission, "data", "gemini", "fixture", 19)
        with pytest.raises(BudgetError, match="exceed"):
            store.reserve(mission, "data", "gemini", "fixture", 1.0000000001)
        last = store.reserve(mission, "data", "gemini", "fixture", 1)
        with pytest.raises(BudgetError, match="exceed"):
            store.reserve(mission, "data", "gemini", "fixture", 0.0000000001)
        assert store.budget()["allowance"]["reserved_usd"] == 20
        assert store.budget()["allowance"]["remaining_usd"] == 0
    finally:
        store.close()


def test_mission_cap_counts_both_providers_and_reservations(tmp_path, monkeypatch):
    store, _ = prepared(tmp_path, monkeypatch)
    try:
        store.authorize_research_allowance()
        mission = store.create("Synthetic capped mission", "live", max_cost_usd=2)["id"]
        a = store.reserve(mission, "coordinator", "openai", "fixture", 1.5)
        with pytest.raises(BudgetError, match="mission"):
            store.reserve(mission, "data", "gemini", "fixture", .500000001)
        store.settle(a, cost=1.2)
        store.reserve(mission, "data", "gemini", "fixture", .8)
        assert store.budget()["allowance"]["remaining_usd"] == 18
    finally:
        store.close()


def test_mission_cap_serializes_threads(tmp_path, monkeypatch):
    store, _ = prepared(tmp_path, monkeypatch)
    try:
        store.authorize_research_allowance()
        mission = store.create("Synthetic concurrent cap", "live", max_cost_usd=2)["id"]
        def attempt(_):
            try: return store.reserve(mission, "data", "gemini", "fixture", .5)
            except BudgetError: return None
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        assert len([r for r in results if r]) == 4
        assert store.snapshot(mission)["mission"]["max_cost_usd"] == 2
    finally:
        store.close()


def test_api_new_missions_default_to_two_dollars(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        h = {"Origin":"http://testserver", "Content-Type":"application/json"}
        response = client.post("/api/missions", headers=h, json={"prompt":"Synthetic no-dispatch mission", "mode":"live"})
        response.raise_for_status()
        assert response.json()["max_cost_usd"] == 2
        assert app.state.engine.active_id is None
