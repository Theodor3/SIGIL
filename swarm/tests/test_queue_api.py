"""HTTP controls remain explicit; status requests never dispatch work."""
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.engine import Engine, MAX_MISSION_SECONDS
from swarm.store import Store

HEADERS = {'origin': 'http://testserver'}


class QueueFixture:
    def __init__(self, engine, store, root):
        self.calls = []
    def status(self):
        return {'enabled': False, 'state': 'off'}
    def inventory(self):
        return {'board': {'counts': {'blocked': 4, 'ready': 0}, 'blocked': [],
                          'ready_count': 0, 'error': None}, 'missions': [], 'reasons': []}
    def start(self, ids, **fields):
        self.calls.append(('start', ids, fields))
        return self.status()
    def stop(self):
        self.calls.append(('stop',))
        return self.status()
    def prepare(self, body):
        self.calls.append(('prepare', body))
        return {'mission': {'id': 'm_' + 'a'*16}}
    def shutdown(self):
        pass


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr('swarm.app.BoundedQueue', QueueFixture)
    app = create_app(tmp_path)
    with TestClient(app) as connection:
        yield connection, app.state.queue


def test_status_is_read_only_and_explains_empty_queue(client):
    connection, queue = client
    response = connection.get('/api/queue')
    assert response.status_code == 200
    value = response.json()
    assert value['session']['enabled'] is False
    assert value['inventory']['board']['counts']['blocked'] == 4
    assert value['inventory']['reasons']
    assert queue.calls == []


def test_queue_mutations_need_origin_and_explicit_json(client):
    connection, queue = client
    body = {'mission_ids': ['m_'+'a'*16]}
    assert connection.post('/api/queue/start', json=body).status_code == 403
    assert connection.post('/api/queue/start', data='{}', headers=HEADERS).status_code == 415
    assert queue.calls == []


@pytest.mark.parametrize('bad', [
    {'mission_ids': []}, {'mission_ids': ['x']*4},
    {'mission_ids': ['x'], 'duration_minutes': 61},
    {'mission_ids': ['x'], 'duration_minutes': True},
    {'mission_ids': ['x'], 'cadence_minutes': 0},
    {'mission_ids': ['x'], 'mode': 'subscription'},
    {'mission_ids': ['x'], 'paid_confirmed': 'true'},
    {'mission_ids': ['x'], 'unknown': True},
])
def test_queue_request_bounds_are_strict(client, bad):
    connection, queue = client
    assert connection.post('/api/queue/start', json=bad, headers=HEADERS).status_code == 422
    assert not queue.calls


def test_prepare_and_start_are_separate_actions(client):
    connection, queue = client
    assert connection.post('/api/queue/prepare', json={'prompt': 'Fixture', 'mode': 'local'}, headers=HEADERS).status_code == 200
    assert [call[0] for call in queue.calls] == ['prepare']
    assert connection.post('/api/queue/start', json={'mission_ids': ['m_'+'a'*16]}, headers=HEADERS).status_code == 200
    assert queue.calls[-1][2] == {'mode': 'local', 'duration_minutes': 20,
                                 'cadence_minutes': 1, 'paid_confirmed': False}


@pytest.mark.parametrize('seconds', [0, -1, True, float('inf'), float('nan'), MAX_MISSION_SECONDS+1])
def test_engine_rejects_bad_session_runtime_before_dispatch(tmp_path, seconds):
    store = Store(tmp_path)
    engine = Engine(store, SimpleNamespace())
    mission = store.create('Synthetic no generation', 'demo')
    try:
        with pytest.raises(ValueError, match='runtime'):
            engine.start(mission['id'], max_runtime_seconds=seconds)
        assert engine.thread is None
        assert store.snapshot(mission['id'])['mission']['status'] == 'ready'
    finally:
        store.close()


def test_engine_applies_shorter_deadline_before_worker_thread(tmp_path):
    store = Store(tmp_path)
    engine = Engine(store, SimpleNamespace())
    mission = store.create('Synthetic no generation', 'demo')
    observed = []
    engine._run = lambda identity: observed.append((engine.deadline, store.snapshot(identity)['mission']['max_runtime_minutes']))
    try:
        before_budget = store.budget()
        engine.start(mission['id'], max_runtime_seconds=30)
        engine.thread.join(3)
        assert observed and observed[0][0] is not None
        assert observed[0][1] == .5
        assert store.budget() == before_budget
    finally:
        store.close()


def test_engine_does_not_extend_session_during_slow_readiness(tmp_path, monkeypatch):
    store = Store(tmp_path)
    clock = [100.0]
    monkeypatch.setattr('swarm.engine.time.monotonic', lambda: clock[0])
    def local_status():
        clock[0] += 2
        return {'configured': True}
    providers = SimpleNamespace(local=SimpleNamespace(status=local_status))
    studio = SimpleNamespace(manifest=lambda: {'is_current': True})
    engine = Engine(store, providers, studio=studio)
    mission = store.create('Synthetic slow readiness', 'local')
    try:
        with pytest.raises(ValueError, match='expired during readiness'):
            engine.start(mission['id'], max_runtime_seconds=1)
        assert engine.thread is None
        assert engine.active_id is None
        assert store.snapshot(mission['id'])['mission']['status'] == 'ready'
    finally:
        store.close()
