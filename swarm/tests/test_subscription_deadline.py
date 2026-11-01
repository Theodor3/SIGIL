"""Reported subscription lifetime respects its explicit permission window."""
import time
from datetime import datetime

from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.engine import Engine
from swarm.providers import Providers
from swarm.store import Store
from swarm.tests.test_subscription import Adapter, PATH, Studio, approval, create


def test_subscription_deadline_matches_five_minute_receipt_before_dispatch(tmp_path):
    value = approval()
    expected_stop = datetime.fromisoformat(value['stop_at'])
    observed = []
    class DeadlineAdapter(Adapter):
        def run(self, *args, **kwargs):
            data = app.state.store.snapshot(mid)
            assert datetime.fromisoformat(data['mission']['deadline_at']) == expected_stop
            assert data['mission']['deadline_at'] == data['subscription_calls'][0]['dispatch_window']['stop_at']
            assert 4.9 < data['mission']['max_runtime_minutes'] <= 5
            assert 0 < app.state.engine.deadline - time.monotonic() <= 300
            observed.append(True)
            return super().run(*args, **kwargs)
    adapter = DeadlineAdapter()
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin': 'http://testserver'}) as client:
        mid = create(client)
        client.post('/api/subscription/preflight', json={})
        assert client.post(f'/api/subscription/missions/{mid}/run', json=value).status_code == 200
        app.state.engine.thread.join(5)
        assert observed == [True]
        assert app.state.store.snapshot(mid)['mission']['status'] == 'needs_review'


def test_shorter_private_caller_bound_is_preserved_before_thread_start(tmp_path, monkeypatch):
    value = approval()
    observed = []
    class HeldThread:
        def __init__(self, *args, **kwargs):
            pass
        def start(self):
            mission = store.snapshot(mid)['mission']
            assert mission['max_runtime_minutes'] == 1
            assert datetime.fromisoformat(mission['deadline_at']) < datetime.fromisoformat(value['stop_at'])
            assert 0 < engine.deadline - time.monotonic() <= 60
            observed.append(True)
        def is_alive(self):
            return False
    monkeypatch.setattr('swarm.engine.threading.Thread', HeldThread)
    store = Store(tmp_path)
    try:
        adapter = Adapter()
        adapter.verified = True
        engine = Engine(store, Providers(), studio=Studio(), subscription_adapter=adapter)
        mid = store.create('Synthetic deadline fixture', 'subscription')['id']
        data = store.get(mid)
        data['mission']['packet_path'] = PATH
        store.save(data)
        engine.start(mid, subscription_approval=value, max_runtime_seconds=60)
        assert observed == [True] and adapter.calls == 0
        assert store.snapshot(mid)['mission']['subscription_approval'] == value
    finally:
        store.close()
