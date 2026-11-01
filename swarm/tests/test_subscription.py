import hashlib
import json
import threading
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.claude_code import ClaudeCodeBlocked
from swarm.models import ToolRequest
from swarm.store import BudgetError, Store
from swarm.subscription import MODEL, check_approval

PATH = 'docs/fixture-packet.json'
TEXT = json.dumps({'schema_version': 1, 'status': 'supplied_text_excerpt_not_original_document',
                   'eligibleForReturns': False, 'excerpt': 'Annual prior3-4%, current3.75-4.75%'})


class Studio:
    files = {PATH: TEXT}
    def manifest(self):
        return {'commit': 'a'*40, 'branch': 'fixture', 'is_current': True,
                'file_count': 1, 'files': [{'path':PATH, 'size':len(TEXT)}],
                'capabilities': {'run_pytest':False}, 'execution_note':'fixture'}
    def read(self, path, start=1):
        assert path == PATH
        return {'path':path,'start':1,'end':1,'total_lines':1,'text':TEXT,
                'complete_file':True,'text_truncated':False,'line_truncated':False,
                'sha256':hashlib.sha256(TEXT.encode()).hexdigest(),'commit':'a'*40}


class Adapter:
    def __init__(self, failure=None):
        self.verified = False
        self.failure = failure
        self.calls = 0
        self.entered = threading.Event()
    def status(self):
        return {'installed':True,'auth_recently_verified':self.verified,'quota_remaining':None}
    def check_auth(self):
        self.verified = True
        return {'loggedIn':True,'authMethod':'claude.ai','apiProvider':'firstParty','subscriptionType':'pro'}
    def run(self, packet, prompt, schema, **kwargs):
        self.calls += 1
        assert kwargs['extra_usage_disabled_confirmed'] is True
        assert kwargs['model'] == MODEL and packet['eligibleForReturns'] is False
        kwargs['progress']('auth_preflight')
        if self.failure == 'auth':
            raise ClaudeCodeBlocked('Fixture auth failure')
        kwargs['progress']('generation_launch')
        self.entered.set()
        if self.failure == 'cancel':
            assert kwargs['cancel'].wait(3)
            raise ClaudeCodeBlocked('Cancelled')
        if self.failure:
            raise ClaudeCodeBlocked('Fixture quota failure')
        return {'result': {'summary':'Supplied arithmetic only','artifact_title':'Comparison',
                'artifact_body':'Midpoint3.5 to4.25, +0.75pp; timestamps unverified.',
                'eligibleForReturns':False}, 'model':MODEL,'quota_remaining':None,
                'api_cost_usd':None,'tokens':{'inputTokens':10,'outputTokens':20}}


def approval():
    instant = datetime.now(timezone.utc)
    return {'usage_credits_disabled':True,'checked_at':instant.isoformat(),
            'verification_note':'Fixture per-run confirmation, not live account evidence',
            'no_new_after':(instant + timedelta(minutes=2)).isoformat(),
            'stop_at':(instant + timedelta(minutes=5)).isoformat()}


def create(client):
    r = client.post('/api/subscription/missions', json={'prompt':'Check supplied arithmetic',
                    'packet_path':PATH,'public_packet_confirmed':True})
    assert r.status_code == 200, r.text
    return r.json()['id']


def test_dispatcher_receipt_provenance_review_and_ledger_separation(tmp_path):
    adapter = Adapter()
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin':'http://testserver'}) as client:
        mid = create(client)
        before = app.state.store.budget()
        assert client.post(f'/api/missions/{mid}/run', json={}).status_code == 400
        assert client.post(f'/api/subscription/missions/{mid}/run',json=approval()).status_code == 400
        assert client.post('/api/subscription/preflight',json={}).status_code == 200
        assert client.post(f'/api/subscription/missions/{mid}/run',json=approval()).status_code == 200
        app.state.engine.thread.join(5)
        data = client.get(f'/api/missions/{mid}').json()
        assert data['mission']['status'] == 'needs_review' and adapter.calls == 1
        assert data['mission']['spent_usd'] is None and data['calls'] == []
        receipt = data['subscription_calls'][0]
        assert receipt['packet_read_id'] == data['tool_results'][0]['id']
        assert receipt['packet_sha256'] == hashlib.sha256(TEXT.encode()).hexdigest()
        assert receipt['api_cost_usd'] is None and receipt['quota_usage'] == 'reported_tokens_only'
        assert app.state.store.budget() == before
        exported = client.get(f'/api/missions/{mid}/export')
        assert exported.status_code == 200 and 'Subscription quota receipts' in exported.text
        assert client.post(f'/api/subscription/missions/{mid}/run',json=approval()).status_code == 400
        r = client.post(f'/api/missions/{mid}/review',json={'accepted':True,'reviewer':'codex',
                        'note':'Fixture-only review of supplied arithmetic, not real evidence'})
        assert r.status_code == 200
        assert client.get('/api/readiness').json()['can_start_subscription'] is False


@pytest.mark.parametrize('failure,usage', [('auth','not_started'),('quota','unknown'),('cancel','unknown')])
def test_fail_closed_stop_no_retry_no_api_fallback(tmp_path, failure, usage):
    adapter = Adapter(failure)
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin':'http://testserver'}) as client:
        mid = create(client)
        client.post('/api/subscription/preflight',json={})
        client.post(f'/api/subscription/missions/{mid}/run',json=approval())
        if failure == 'cancel':
            assert adapter.entered.wait(3)
            assert client.post(f'/api/missions/{mid}/stop',json={}).status_code == 200
        app.state.engine.thread.join(5)
        data = app.state.store.snapshot(mid)
        assert data['mission']['status'] in ('blocked','stopped') and adapter.calls == 1
        assert data['subscription_calls'][0]['quota_usage'] == usage
        assert data['calls'] == [] and not data['artifacts']
        assert client.post(f'/api/subscription/missions/{mid}/run',json=approval()).status_code == 400


def test_api_reservation_and_worker_tool_escape_blocked(tmp_path):
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=Adapter())
    with TestClient(app, headers={'origin':'http://testserver'}) as client:
        mid = create(client)
        for provider in ('local','openai','claude_code_subscription'):
            with pytest.raises(BudgetError):
                app.state.store.reserve(mid,'data',provider,MODEL,0)
        result = app.state.engine.tools.execute(mid,'data',ToolRequest(tool='paper_search',query='synthetic fixture'),lambda:None)
        assert result['status'] == 'blocked'


def test_expired_confirmation_and_cutoff():
    value = approval()
    value['checked_at'] = (datetime.now(timezone.utc)-timedelta(minutes=6)).isoformat()
    with pytest.raises(ValueError):
        check_approval(value)
    value['checked_at'] = 'not a timestamp'
    with pytest.raises(ValueError):
        check_approval(value)


def test_restart_preserves_unknown_subscription_usage_without_api_uncertainty(tmp_path):
    store = Store(tmp_path)
    mid = store.create('Fixture','subscription')['id']
    data = store.get(mid)
    data['mission']['status'] = 'running'
    data['subscription_calls'] = [{'status':'running','quota_usage':'unknown','api_cost_usd':None}]
    store.save(data)
    store.close()
    store = Store(tmp_path)
    assert store.snapshot(mid)['subscription_calls'][0]['quota_usage'] == 'unknown'
    assert store.snapshot(mid)['mission']['status'] == 'blocked'
    assert store.ledger == [] and not store.budget()['uncertain']
    store.close()


@pytest.mark.parametrize('turns', [2, 4, 8])
def test_per_mission_turn_allowance_is_persisted_and_dispatched(tmp_path, turns):
    class TurnAdapter(Adapter):
        def run(self, *args, **kwargs):
            assert kwargs['max_turns'] == turns
            return super().run(*args, **kwargs)
    adapter = TurnAdapter()
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin':'http://testserver'}) as client:
        mid = client.post('/api/subscription/missions', json={'prompt':'Fixture bounded task',
            'packet_path':PATH,'public_packet_confirmed':True,'max_turns':turns}).json()['id']
        client.post('/api/subscription/preflight', json={})
        assert client.post(f'/api/subscription/missions/{mid}/run',json=approval()).status_code == 200
        app.state.engine.thread.join(5)
        data = app.state.store.snapshot(mid)
        assert data['mission']['status'] == 'needs_review' and adapter.calls == 1
        assert data['mission']['max_turns'] == data['subscription_calls'][0]['max_turns'] == turns


@pytest.mark.parametrize('turns', [0, 9, True, '8', 8.0])
def test_invalid_turn_allowance_rejected_before_mission_creation(tmp_path, turns):
    adapter = Adapter()
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin':'http://testserver'}) as client:
        r = client.post('/api/subscription/missions', json={'prompt':'Fixture',
            'packet_path':PATH,'public_packet_confirmed':True,'max_turns':turns})
        assert r.status_code == 422 and adapter.calls == 0


def test_readiness_reports_actual_adapter_deadlines(tmp_path):
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=Adapter())
    with TestClient(app) as client:
        value = client.get('/api/readiness').json()['subscription']
        assert value['max_window_minutes'] == 30
        assert 'Explicit per-mission' in value['dispatch']
        assert 'owner-confirmed' in value['authorization']
        assert 'no_new_after' not in value and 'stop_at' not in value
