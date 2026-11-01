"""Explicit finite subscription authorization; no provider/auth execution."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from swarm.app import create_app
from swarm.models import SubscriptionRun
from swarm.subscription import check_approval
from swarm.tests.test_subscription import Adapter, Studio, approval, create


def test_explicit_window_is_validated_without_renewing_historical_defaults():
    value = approval()
    assert check_approval(value) == (datetime.fromisoformat(value['no_new_after']),
                                     datetime.fromisoformat(value['stop_at']))
    from swarm.claude_code import NO_NEW_AFTER, STOP_AT
    assert NO_NEW_AFTER == datetime.fromisoformat('2026-10-28T12:20:00-04:00')
    assert STOP_AT == datetime.fromisoformat('2026-10-28T12:25:00-04:00')


@pytest.mark.parametrize('fault', ['missing_start', 'missing_stop', 'naive_start',
    'naive_stop', 'past_start', 'reversed', 'over_thirty_minutes', 'malformed'])
def test_invalid_window_never_becomes_a_new_window(fault):
    value = approval()
    instant = datetime.now(timezone.utc)
    if fault == 'missing_start':
        value.pop('no_new_after')
    elif fault == 'missing_stop':
        value.pop('stop_at')
    elif fault == 'naive_start':
        value['no_new_after'] = (instant + timedelta(minutes=2)).replace(tzinfo=None).isoformat()
    elif fault == 'naive_stop':
        value['stop_at'] = (instant + timedelta(minutes=5)).replace(tzinfo=None).isoformat()
    elif fault == 'past_start':
        value['no_new_after'] = (instant - timedelta(seconds=1)).isoformat()
    elif fault == 'reversed':
        value['no_new_after'], value['stop_at'] = value['stop_at'], value['no_new_after']
    elif fault == 'over_thirty_minutes':
        value['stop_at'] = (instant + timedelta(minutes=31)).isoformat()
    else:
        value['stop_at'] = 'not-a-time'
    with pytest.raises(ValueError, match='No automatic renewal'):
        check_approval(value)


@pytest.mark.parametrize('fault', ['stale', 'future', 'naive', 'off_not_confirmed'])
def test_run_confirmation_remains_current_and_explicit(fault):
    value = approval()
    if fault == 'stale':
        value['checked_at'] = (datetime.now(timezone.utc) - timedelta(minutes=6)).isoformat()
    elif fault == 'future':
        value['checked_at'] = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
    elif fault == 'naive':
        value['checked_at'] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    else:
        value['usage_credits_disabled'] = False
    with pytest.raises(ValueError):
        check_approval(value)


def test_model_requires_both_explicit_window_fields():
    value = approval()
    value.pop('stop_at')
    with pytest.raises(ValidationError):
        SubscriptionRun.model_validate(value)


def test_exact_window_is_persisted_and_forwarded_once(tmp_path):
    value = approval()
    expected = tuple(datetime.fromisoformat(value[key]) for key in ('no_new_after', 'stop_at'))
    class WindowAdapter(Adapter):
        def run(self, *args, **kwargs):
            assert kwargs['dispatch_window'] == expected
            return super().run(*args, **kwargs)
    adapter = WindowAdapter()
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin': 'http://testserver'}) as client:
        mid = create(client)
        client.post('/api/subscription/preflight', json={})
        assert client.post(f'/api/subscription/missions/{mid}/run', json=value).status_code == 200
        app.state.engine.thread.join(5)
        data = app.state.store.snapshot(mid)
        assert data['mission']['status'] == 'needs_review'
        assert data['mission']['subscription_approval'] == value
        assert data['subscription_calls'][0]['dispatch_window'] == {
            key: value[key] for key in ('no_new_after', 'stop_at')}
        assert adapter.calls == 1 and data['calls'] == []
        assert client.post(f'/api/subscription/missions/{mid}/run', json=approval()).status_code == 400
        assert adapter.calls == 1


def test_expired_window_stays_rejected_before_adapter_run(tmp_path):
    adapter = Adapter()
    app = create_app(tmp_path, studio=Studio(), subscription_adapter=adapter)
    with TestClient(app, headers={'origin': 'http://testserver'}) as client:
        mid = create(client)
        client.post('/api/subscription/preflight', json={})
        value = approval()
        value['no_new_after'] = (datetime.now(timezone.utc)-timedelta(seconds=1)).isoformat()
        response = client.post(f'/api/subscription/missions/{mid}/run', json=value)
        assert response.status_code == 400
        assert adapter.calls == 0
        data = app.state.store.snapshot(mid)
        assert data['mission']['status'] == 'ready' and not data.get('subscription_calls')
