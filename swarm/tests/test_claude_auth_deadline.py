"""Synthetic regressions: read-only auth does not renew generation authority."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from swarm import claude_code as cc


AUTH = {'loggedIn': True, 'authMethod': 'claude.ai',
        'apiProvider': 'firstParty', 'subscriptionType': 'pro'}


def test_read_only_auth_uses_own_deadline_after_generation_window(tmp_path, monkeypatch):
    expired = datetime(2000, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(cc, 'NO_NEW_AFTER', expired)
    monkeypatch.setattr(cc, 'STOP_AT', expired)
    monkeypatch.setattr(cc, 'check_managed_policy', lambda: None)
    calls = []
    before = datetime.now(timezone.utc)

    def fake_process(args, **kwargs):
        calls.append((args, kwargs))
        assert before < kwargs['stop_at'] <= datetime.now(timezone.utc) + timedelta(seconds=30)
        assert kwargs['timeout'] == 15
        assert '-p' not in args
        return cc.VERSION if '--version' in args else json.dumps(AUTH)

    monkeypatch.setattr(cc, 'bounded_process', fake_process)
    adapter = cc.ClaudeCodeAdapter('/fixture', tmp_path / 'lock')
    assert adapter.check_auth() == AUTH
    assert len(calls) == 2
    assert calls[0][1]['stop_at'] == calls[1][1]['stop_at']
    assert 'auth' in calls[1][0]
    assert adapter.status()['auth_recently_verified'] is True

    # Successful diagnostics cannot authorize generation after the old cutoff.
    with pytest.raises(cc.ClaudeCodeBlocked, match='authorized cutoff'):
        adapter.run({}, 'Fixture', object, model='claude-sonnet-4-6',
                    extra_usage_disabled_confirmed=True)
    assert len(calls) == 2


@pytest.mark.parametrize('failure', ['version', 'auth'])
def test_read_only_failure_clears_previous_auth_without_generation(tmp_path, monkeypatch, failure):
    monkeypatch.setattr(cc, 'check_managed_policy', lambda: None)
    calls = []

    def fake_process(args, **kwargs):
        calls.append(args)
        assert '-p' not in args
        if '--version' in args:
            return 'changed-version' if failure == 'version' else cc.VERSION
        return json.dumps({**AUTH, 'loggedIn': False})

    monkeypatch.setattr(cc, 'bounded_process', fake_process)
    adapter = cc.ClaudeCodeAdapter('/fixture', tmp_path / 'lock')
    adapter.auth_checked_at = cc.time.monotonic()
    with pytest.raises(cc.ClaudeCodeBlocked):
        adapter.check_auth()
    assert adapter.status()['auth_recently_verified'] is False
    assert len(calls) == (1 if failure == 'version' else 2)
