"""Deterministic draft/test binding; model verdicts cannot manufacture a pass."""
import hashlib
import re

TEST_TARGET = re.compile(r'^(?:tests|api/tests|swarm/tests|web/tests)/[a-zA-Z0-9_./-]+\.py$')


def valid_target(target):
    return isinstance(target, str) and len(target) <= 200 and bool(TEST_TARGET.fullmatch(target)) and '..' not in target.split('/') and '//' not in target


def test_gate(data, commit):
    mission = data['mission']
    if not (mission.get('requires_tests') or (mission.get('mode') == 'local' and (mission.get('local_role') == 'engineering' or bool(data.get('drafts'))))):
        return {'status': 'not_required', 'acceptance_authority': False}
    target = mission.get('test_target')
    fail = lambda reason: {'status': 'blocked', 'reason': reason, 'acceptance_authority': False}
    if not isinstance(commit, str) or not re.fullmatch('[a-f0-9]{40}', commit):
        return fail('Pinned commit is missing.')
    if not valid_target(target):
        return fail('Explicit bounded Python test target required.')
    latest = {d['path']: d for d in data.get('drafts', [])}
    if not latest:
        return fail('No staged draft exists; narrative code is not executed.')
    expected = [{'id': d['id'], 'path': d['path'], 'sha256': hashlib.sha256(d['content'].encode()).hexdigest()}
                for d in latest.values()]
    records = [r for r in data.get('tool_results', []) if r.get('tool') == 'run_tests']
    if not records:
        return fail('Matching container test receipt missing.')
    record = records[-1]
    result = record.get('result', {})
    if (record.get('status') != 'completed' or result.get('status') != 'passed'
            or result.get('executed') is not True or type(result.get('exit_code')) is not int
            or result['exit_code'] != 0 or result.get('truncated') is not False):
        return fail('Latest matching test did not execute and pass completely.')
    if result.get('commit') != commit or result.get('target') != target or result.get('checked_drafts') != expected:
        return fail('Test receipt does not match the pinned commit and current draft versions.')
    return {'status': 'passed', 'receipt_id': record['id'], 'commit': commit, 'target': target,
            'checked_drafts': expected, 'acceptance_authority': False,
            'note': 'Tests passed for these drafts only; external evidence review is still required.'}
