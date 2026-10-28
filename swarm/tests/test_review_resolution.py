import copy
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.models import GEMINI_MODEL
from swarm.providers import Providers
from swarm.review_status import review_flags
from swarm.store import Store


def decision(disposition='rejected'):
    return dict(disposition=disposition, reviewer='codex', note='Independent review rejected unsupported claims.',
                evidence='Synthetic review fixture, not actual research.')


def terminal(store, mode='live', status='needs_review'):
    mid=store.create('Synthetic historical mission',mode)['id']
    data=store.get(mid)
    data['mission']['status']=status
    store.save(data)
    store.artifact(mid,'engineering','Fixture','Unvalidated fixture body')
    return mid


def test_append_preserves_raw_history_and_survives_restart(tmp_path):
    store=Store(tmp_path)
    mid=terminal(store)
    before=store.snapshot(mid)
    budget=store.budget()
    resolution=store.resolve_review(mid,decision())
    after=store.snapshot(mid)
    assert after['mission'].pop('review_resolution')==resolution
    assert after==before
    assert store.budget()==budget
    assert store.resolve_review(mid,decision())==resolution  # idempotent, no overwrite
    with pytest.raises(ValueError,match='immutable'):
        store.resolve_review(mid,decision('reviewed'))
    store.close()
    store=Store(tmp_path)
    try:
        assert store.snapshot(mid)['mission']['review_resolution']==resolution
        assert store.snapshot(mid)['artifacts']==before['artifacts']
    finally: store.close()


def test_resolution_write_failure_rolls_back_memory_and_disk(tmp_path,monkeypatch):
    store=Store(tmp_path)
    mid=terminal(store)
    before=store.snapshot(mid)
    def fail(*args,**kwargs): raise RuntimeError('Synthetic event write failure')
    monkeypatch.setattr(store,'_insert_event',fail)
    with pytest.raises(RuntimeError): store.resolve_review(mid,decision())
    assert store.snapshot(mid)==before
    store.close()
    store=Store(tmp_path)
    try: assert store.snapshot(mid)==before
    finally: store.close()


def test_concurrent_different_decisions_cannot_overwrite(tmp_path):
    store=Store(tmp_path)
    try:
        mid=terminal(store)
        def attempt(kind):
            try: return store.resolve_review(mid,decision(kind))['disposition']
            except ValueError: return 'conflict'
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(attempt,['rejected','superseded']))
        assert results.count('conflict')==1
        assert store.snapshot(mid)['mission']['review_resolution']['disposition'] in results
    finally: store.close()


@pytest.mark.parametrize('status',['ready','running','stopping'])
def test_nonterminal_cannot_resolve(tmp_path,status):
    store=Store(tmp_path)
    try:
        mid=terminal(store,status=status)
        with pytest.raises(ValueError,match='terminal'): store.resolve_review(mid,decision())
    finally: store.close()


def test_reserved_call_cannot_be_hidden(tmp_path):
    store=Store(tmp_path)
    try:
        mid=terminal(store,mode='local')
        store.reserve(mid,'engineering','local','sigil-local',0)
        with pytest.raises(ValueError,match='unsettled'): store.resolve_review(mid,decision())
    finally: store.close()


def test_api_counts_flags_origin_guard_and_billing_remain_honest(tmp_path):
    app=create_app(tmp_path,providers=Providers())
    with TestClient(app) as client:
        store=app.state.store
        resolved=terminal(store)
        pending=terminal(store)
        evidence=terminal(store)
        store.settings['expires_on']='2999-01-01'
        billed=terminal(store,status='blocked')
        call=store.reserve(billed,'data','gemini',GEMINI_MODEL,.1)
        store.settle(call,cost=None,error='Synthetic uncertain charge')
        before=copy.deepcopy(store.budget())
        url=f'/api/missions/{resolved}/review-resolution'
        assert client.post(url,json=decision()).status_code==403
        headers={'Origin':'http://testserver'}
        response=client.post(url,json=decision(),headers=headers)
        assert response.status_code==200
        assert response.json()['status']=='needs_review'
        assert not response.json()['requires_review'] and not response.json()['needs_attention']
        assert response.json()['retryable'] is False
        assert 'coordinator_review' not in response.json()
        assert response.json()['evidence_status']=='not_validated'
        export=client.get(f'/api/missions/{resolved}/export').text
        assert 'Status: needs_review' in export
        assert '## Administrative review resolution' in export
        assert 'no artifact acceptance or validation' in export
        assert decision()['evidence'] in export
        client.post(f'/api/missions/{evidence}/review-resolution',json=decision('evidence_blocked'),headers=headers).raise_for_status()
        state=client.get('/api/state').json()
        assert state['runtime']['review_count']==1
        assert state['runtime']['raw_review_count']==3
        assert state['runtime']['resolved_review_count']==2
        assert state['runtime']['attention_count']==3  # pending + evidence + uncertain billed mission
        assert any(b['code']=='billing_uncertain' for b in state['runtime']['blockers'])
        assert not state['runtime']['can_start_live']
        assert store.budget()==before
        assert review_flags(store.snapshot(evidence)['mission'])==dict(requires_review=False,needs_attention=True)
        assert client.post(url,json=decision('reviewed'),headers=headers).status_code==400
        app.state.engine.active_id=pending
        assert client.post(f'/api/missions/{pending}/review-resolution',json=decision(),headers=headers).status_code==400
        app.state.engine.active_id=None


@pytest.mark.parametrize('field,value',[('note',' '*20),('evidence',' '*10),('disposition','accepted')])
def test_blank_or_acceptance_payload_rejected(tmp_path,field,value):
    store=Store(tmp_path)
    try:
        mid=terminal(store)
        payload=decision();payload[field]=value
        with pytest.raises(ValueError): store.resolve_review(mid,payload)
        assert 'review_resolution' not in store.snapshot(mid)['mission']
    finally: store.close()
