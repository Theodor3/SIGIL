import json
import os
import sys
import threading
from datetime import datetime

import pytest
from pydantic import BaseModel, ConfigDict

from swarm import claude_code as cc

MODEL = 'claude-sonnet-4-6'


class Finding(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    midpoint_change: float
    eligible: bool


def response():
    return {'type': 'result', 'subtype': 'success', 'is_error': False,
            'structured_output': {'midpoint_change': .75, 'eligible': False},
            'modelUsage': {MODEL: {'inputTokens': 10, 'outputTokens': 12,
                'cacheReadInputTokens': 0, 'cacheCreationInputTokens': 0}}}


def test_env_excludes_all_credentials_provider_proxy_and_injection_overrides():
    env = cc.child_environment({'HOME': '/home/fixture', 'SystemRoot': 'C:/Windows',
        'ANTHROPIC_API_KEY': 'fixture', 'ANTHROPIC_AUTH_TOKEN': 'fixture',
        'CLAUDE_CODE_OAUTH_TOKEN': 'fixture', 'CLAUDE_CODE_USE_BEDROCK': '1',
        'CLAUDE_CONFIG_DIR': '/other', 'HTTP_PROXY': 'fixture', 'NODE_OPTIONS': 'fixture',
        'PATH': '/untrusted', 'CLAUDE_CODE_MAX_RETRIES': '12'})
    assert env['HOME'] == '/home/fixture'
    assert env['CLAUDE_CODE_MAX_RETRIES'] == '0'
    assert not any('fixture' == value for value in env.values())
    assert env['PATH'] != '/untrusted'
    assert 'CLAUDE_CONFIG_DIR' not in env


@pytest.mark.parametrize('field,value', [('subtype','error_max_turns'), ('is_error',True),
    ('modelUsage',{'unexpected': {}}), ('structured_output', {'midpoint_change':'bad','eligible':False}),
    ('permission_denials', ['Read'])])
def test_result_fails_closed(field, value):
    r = response()
    r[field] = value
    with pytest.raises(cc.ClaudeCodeBlocked):
        cc.validate_result(json.dumps(r), Finding, MODEL)


def test_subscription_usage_is_not_free_local_or_api_dollars():
    r = cc.validate_result(json.dumps(response()), Finding, MODEL)
    assert r['api_cost_usd'] is None and r['quota_remaining'] is None
    assert not r['quota_enforceable'] and r['provider'] == 'claude_code_subscription'


def test_no_generation_without_billing_confirmation(tmp_path, monkeypatch):
    monkeypatch.setattr(cc, 'bounded_process', lambda *a, **k: pytest.fail('Must not launch'))
    with pytest.raises(cc.ClaudeCodeBlocked, match='usage credits'):
        cc.ClaudeCodeAdapter('/fixture', tmp_path/'lock').run({}, 'Review', Finding, model=MODEL)


def test_single_worker_lock_rejects_concurrent_use(tmp_path):
    with cc.single_worker(tmp_path/'lock'):
        with pytest.raises(cc.ClaudeCodeBlocked):
            with cc.single_worker(tmp_path/'lock'):
                pytest.fail('Concurrent worker allowed')
    with cc.single_worker(tmp_path/'lock'):
        pass


def test_worker_body_error_is_not_mislabeled_as_lock_failure(tmp_path):
    with pytest.raises(OSError, match='fixture-body'):
        with cc.single_worker(tmp_path/'lock'):
            raise OSError('fixture-body')
    with cc.single_worker(tmp_path/'lock'):
        pass


@pytest.fixture
def future_cutoff(monkeypatch):
    monkeypatch.setattr(cc, 'STOP_AT', datetime.fromisoformat('2099-01-01T00:00:00+00:00'))
    monkeypatch.setattr(cc, 'NO_NEW_AFTER', datetime.fromisoformat('2099-01-01T00:00:00+00:00'))


def test_bounded_process_output_timeout_and_cancellation(tmp_path, future_cutoff):
    args = [sys.executable, '-c']
    assert cc.bounded_process(args+['print("fixture")'], env=os.environ.copy(), cwd=tmp_path).strip() == 'fixture'
    with pytest.raises(cc.ClaudeCodeBlocked):
        cc.bounded_process(args+['import time; time.sleep(5)'], env=os.environ.copy(), cwd=tmp_path, timeout=.1)
    with pytest.raises(cc.ClaudeCodeBlocked):
        cc.bounded_process(args+['print("x"*400000)'], env=os.environ.copy(), cwd=tmp_path)
    stop = threading.Event()
    timer = threading.Timer(.1, stop.set)
    timer.start()
    try:
        with pytest.raises(cc.ClaudeCodeBlocked):
            cc.bounded_process(args+['import time; time.sleep(5)'], env=os.environ.copy(), cwd=tmp_path, cancel=stop)
    finally:
        timer.join()


@pytest.mark.parametrize('turns', [None, 2, 4, 8])
def test_fixture_integration_no_native_tools_or_fallback(tmp_path, monkeypatch, future_cutoff, turns):
    calls = []
    monkeypatch.setattr(cc, 'check_managed_policy', lambda: None)
    def fake(args, **kwargs):
        calls.append((args, kwargs))
        if '--version' in args:
            return cc.VERSION
        if 'auth' in args:
            return json.dumps({'loggedIn':True,'authMethod':'claude.ai',
                               'apiProvider':'firstParty','subscriptionType':'pro'})
        return json.dumps(response())
    monkeypatch.setattr(cc, 'bounded_process', fake)
    r = cc.ClaudeCodeAdapter('/fixture', tmp_path/'lock').run({'public':True}, 'Review', Finding,
        model=MODEL, extra_usage_disabled_confirmed=True, **({} if turns is None else {'max_turns': turns}))
    assert len(calls) == 3 and r['requires_external_review']
    assert '--tools' not in calls[1][0]  # Variadic tools cannot swallow auth subcommand.
    args, kw = calls[-1]
    assert args[args.index('--max-turns')+1] == str(turns or 2)
    assert r['max_turns'] == (turns or 2)
    assert args[args.index('--tools')+1] == ''
    assert args[args.index('--setting-sources')+1] == ''
    assert '--safe-mode' in args and '--no-session-persistence' in args
    assert '--bare' not in args and '--fallback-model' not in args
    assert not any('skip-permissions' in a for a in args)
    assert b'public' in kw['input_bytes']


@pytest.mark.parametrize('auth', [ {'loggedIn':False}, {'loggedIn':True,'authMethod':'api_key'},
    {'loggedIn':True,'authMethod':'claude.ai','apiProvider':'firstParty','subscriptionType':'team'}])
def test_auth_failure_never_generates(tmp_path, monkeypatch, future_cutoff, auth):
    calls = []
    monkeypatch.setattr(cc, 'check_managed_policy', lambda: None)
    def fake(args, **kwargs):
        calls.append(args)
        return cc.VERSION if '--version' in args else json.dumps(auth)
    monkeypatch.setattr(cc, 'bounded_process', fake)
    with pytest.raises(cc.ClaudeCodeBlocked):
        cc.ClaudeCodeAdapter('/fixture', tmp_path/'lock').run({}, 'Review', Finding,
            model=MODEL, extra_usage_disabled_confirmed=True)
    assert len(calls) == 2 and all('-p' not in a for a in calls)


def test_cutoff_blocks_before_launch(tmp_path, monkeypatch):
    monkeypatch.setattr(cc, 'NO_NEW_AFTER', datetime.fromisoformat('2000-01-01T00:00:00+00:00'))
    with pytest.raises(cc.ClaudeCodeBlocked, match='cutoff'):
        cc.ClaudeCodeAdapter('/fixture', tmp_path/'lock').run({}, 'Review', Finding,
            model=MODEL, extra_usage_disabled_confirmed=True)


@pytest.mark.parametrize('stdout,stderr,expected', [
    (b'{"type":"result","subtype":"error_max_turns"}', b'', 'subtype=error_max_turns'),
    (b'{"error":{"type":"authentication_error","message":"fixture-private"}}', b'', 'code=authentication_error'),
    (b'{"error":{"type":"rate_limit_error"}}', b'', "categories=['rate_limit']"),
    (b'', b'ENOTFOUND fixture-private.example', "categories=['network']"),
    (b'usage limit reached', b'', "categories=['usage_limit']"),
    (b'', b'unknown option --fixture-private', "categories=['arguments']"),
    (b'\xffmalformed', b'opaque failure', "categories=['unclassified']"),
    (b'[]', b'', 'subtype=unknown, code=unknown'),
    (b'{"type":"result","subtype":[],"error":{"type":{}}}', b'', 'subtype=unknown, code=unknown'),
])
def test_failure_diagnostics_are_fixed_labels(stdout, stderr, expected):
    diagnostic = cc.failure_diagnostics(stdout, stderr)
    assert expected in diagnostic
    assert 'fixture-private' not in diagnostic
    assert len(diagnostic) < 600


def test_failure_diagnostics_do_not_echo_secrets_or_unrecognized_codes():
    private = 'fixture-token-ZZ9911 /home/private/user.json https://private.example/?key=fixture'
    raw = json.dumps({'type':'result','subtype':private,
                      'error':{'type':private,'message':private},'errors':[private]}).encode()
    diagnostic = cc.failure_diagnostics(raw, private.encode())
    assert diagnostic == ("categories=['unclassified'], subtype=unknown, code=unknown, "
                          'stdout_present=True, stderr_present=True')
    assert not any(part in diagnostic for part in ('ZZ9911', '/home', 'https://', 'private.example'))


def test_failure_diagnostics_ignore_unknown_suffix_and_non_result_subtype():
    for value in ['error_max_turns\nfixture-secret', 'error_max_turns.fixture-secret']:
        diagnostic = cc.failure_diagnostics(json.dumps({'type':'result','subtype':value}).encode(), b'')
        assert 'subtype=unknown' in diagnostic and 'fixture-secret' not in diagnostic
    assert 'subtype=unknown' in cc.failure_diagnostics(
        b'{"type":"other","subtype":"error_max_turns"}', b'')


def test_failure_diagnostics_bound_input_and_handle_deep_json():
    raw = b'x' * cc.MAX_OUTPUT + b' rate limit'
    assert "categories=['unclassified']" in cc.failure_diagnostics(raw, b'')
    deep = b'[' * 2000 + b']' * 2000
    assert 'subtype=unknown' in cc.failure_diagnostics(deep, b'')


def test_nonzero_process_preserves_only_safe_stdout_stderr_diagnostics(tmp_path, future_cutoff):
    payload = {'type':'result', 'subtype':'error_max_turns',
               'errors':['fixture-secret-output'], 'error':{'type':'api_error'}}
    program = (f'import sys; print({json.dumps(payload)!r}); '
               'print("ECONNRESET fixture-secret-stderr", file=sys.stderr); sys.exit(1)')
    with pytest.raises(cc.ClaudeCodeBlocked) as error:
        cc.bounded_process([sys.executable, '-c', program], env=os.environ.copy(), cwd=tmp_path)
    message = str(error.value)
    assert 'CLI exit=1' in message and 'subtype=error_max_turns' in message and 'code=api_error' in message
    assert "categories=['network']" in message
    assert 'no retry or fallback' in message
    assert 'fixture-secret' not in message and len(message) < 700
    assert list(tmp_path.iterdir()) == []  # No diagnostic file or raw output retained.


@pytest.mark.parametrize('turns', [0, 9, True, '8', 8.0])
def test_invalid_turn_allowance_cannot_launch(tmp_path, monkeypatch, turns):
    monkeypatch.setattr(cc, 'bounded_process', lambda *a, **k: pytest.fail('Must not launch'))
    with pytest.raises(cc.ClaudeCodeBlocked, match='Turn allowance'):
        cc.ClaudeCodeAdapter('/fixture', tmp_path/'lock').run({}, 'Review', Finding,
            model=MODEL, extra_usage_disabled_confirmed=True, max_turns=turns)
