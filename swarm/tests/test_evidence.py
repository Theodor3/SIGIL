import hashlib
import json

import pytest

from swarm.evidence import read_coverage, supplied_excerpt


def receipt(start=1, end=3):
    return {'id': 'tool_fixture', 'agent_id': 'review', 'task_id': 'current',
            'tool': 'read_file', 'status': 'completed', 'result': {
                'path': 'docs/packet.json', 'sha256': 'a' * 64, 'commit': 'b' * 40,
                'start': start, 'end': end, 'total_lines': 3, 'text': 'source',
                'text_truncated': False}}


def coverage(records):
    return read_coverage(records, role='review', task_id='current', path='docs/packet.json',
                         sha256='a' * 64, commit='b' * 40, total_lines=3)['complete']


@pytest.mark.parametrize('field,value', [('agent_id', 'data'), ('task_id', 'old'),
                                           ('status', 'blocked'), ('tool', 'search_code')])
def test_reject_peer_old_task_failed_or_nonread(field, value):
    r = receipt()
    r[field] = value
    assert not coverage([r])


@pytest.mark.parametrize('field,value', [('sha256', 'c' * 64), ('commit', 'd' * 40),
    ('text_truncated', True), ('text_truncated', None), ('start', True), ('text', ''),
    ('total_lines', 4), ('path', 'docs/other.json')])
def test_reject_mismatched_or_incomplete_receipts(field, value):
    r = receipt()
    r['result'][field] = value
    assert not coverage([r])


def test_coverage_requires_no_gaps_and_accepts_complete_chunks():
    assert not coverage([])
    assert not coverage([receipt(1, 1), receipt(3, 3)])
    assert coverage([receipt(2, 3), receipt(1, 1)])
    assert coverage([receipt()])


def packet(text, **kwargs):
    return supplied_excerpt(text, source_url='https://www.sec.gov/example',
        retrieved_at='2026-10-27', context='Annual table including dated column headings',
        start=kwargs.get('start', 1), end=kwargs.get('end', 2))


def test_large_supplied_text_keeps_exact_context_hash_and_scope():
    text = 'Annual table\r\nPrior | Current\r\n' + ('omitted text\n' * 20000)
    p = packet(text)
    assert p['excerpt'] == 'Annual table\r\nPrior | Current\r\n'
    assert p['supplied_text_sha256'] == hashlib.sha256(text.encode()).hexdigest()
    assert p['total_supplied_lines'] == 20002
    assert p['status'] == 'supplied_text_excerpt_not_original_document'
    assert not any(p[k] for k in ('worker_retrieved', 'availability_verified',
                                  'latest_prior_verified', 'eligibleForReturns'))
    assert len(json.dumps(p, indent=2).encode()) < 7500


@pytest.mark.parametrize('text,start,end', [('x\n', 1, 2), ('x\n'*81, 1, 81),
    ('x'*8000+'\n', 1, 1), ('x\n', True, 1), ('api_key="abcdefghijk"\n', 1, 1)])
def test_excerpt_rejects_invalid_oversized_and_sensitive_inputs(text, start, end):
    with pytest.raises(ValueError):
        packet(text, start=start, end=end)
