"""Local prompt compaction preserves delivered source text and read authority."""
import copy
import json

from swarm.engine import Engine
from swarm.models import LocalReport
from swarm.response_contract import response_schema


GROUPS = ('your_current_source_evidence', 'your_prior_source_evidence',
          'upstream_source_evidence', 'team_source_evidence')


def read(index, text, *, truncated=False):
    return {
        'id': f'tool_{index:016x}', 'task_id': 'task-fixture', 'agent_id': 'review',
        'path': f'swarm/fixture-{index}.py', 'start': 1, 'end': 120, 'total_lines': 240,
        'text': text, 'text_truncated': truncated, 'source_text_truncated': truncated,
        'line_truncated': False, 'complete_file': False, 'sha256': 'a' * 64,
        'commit': 'b' * 40,
    }


def recent(evidence):
    return {'id': evidence['id'], 'tool': 'read_file', 'status': 'completed', 'summary': 'read',
            'result': {key: value for key, value in evidence.items()
                       if key not in ('id', 'task_id', 'agent_id', 'source_text_truncated')}}


def context():
    first = read(1, 'A' * 8000, truncated=True)
    second = read(2, 'B' * 6390)
    partial = read(3, 'C' * 3600, truncated=True)
    partial['source_text_truncated'] = False
    full_third = read(3, 'C' * 6000)
    return {
        'mission_mode': 'local', 'allowed_tools': ['read_file'],
        'allowed_recipients': ['coordinator'], 'independent_critique': False,
        GROUPS[0]: [first, second, partial], GROUPS[1]: [], GROUPS[2]: [],
        GROUPS[3]: [copy.deepcopy(first), copy.deepcopy(second)],
        'your_recent_tool_results': [recent(first), recent(second), recent(full_third)],
        'relevant_artifacts': [{'id': 'art-fixture', 'body': 'X' * 32000 + 'CRITICAL_TAIL'}],
    }


def resolved_text(packet, item):
    if 'text' in item:
        return item['text']
    reference = item['text_ref']
    return next(record['text'] for record in packet[reference['group']]
                if record['id'] == reference['id'] and 'text' in record)


def test_duplicate_text_references_preserve_every_original_projection_and_raw_tail():
    before = context()
    after = Engine._deduplicate_local_source_text(copy.deepcopy(before))
    for group in GROUPS:
        assert len(after[group]) == len(before[group])
        for original, compact in zip(before[group], after[group]):
            assert resolved_text(after, compact) == original['text']
            assert {k: v for k, v in compact.items() if k not in ('text', 'text_ref')} == {
                k: v for k, v in original.items() if k != 'text'}
    for original, compact in zip(before['your_recent_tool_results'], after['your_recent_tool_results']):
        assert resolved_text(after, compact['result']) == original['result']['text']
    assert 'text_ref' in after['your_recent_tool_results'][0]['result']
    assert after['your_recent_tool_results'][0]['result']['text_truncated'] is True
    assert after['your_recent_tool_results'][2]['result']['text'] == 'C' * 6000
    assert after['relevant_artifacts'] == before['relevant_artifacts']


def test_schema_visible_read_ids_and_authority_are_unchanged():
    before = context()
    after = Engine._deduplicate_local_source_text(copy.deepcopy(before))
    assert response_schema(LocalReport, json.dumps(after)) == response_schema(LocalReport, json.dumps(before))


def test_different_metadata_or_partial_projection_is_not_aliased():
    packet = context()
    second = copy.deepcopy(packet[GROUPS[0]][1])
    second['agent_id'] = 'engineering'
    packet[GROUPS[3]].append(second)
    Engine._deduplicate_local_source_text(packet)
    assert packet[GROUPS[3]][-1]['text'] == 'B' * 6390
    assert packet[GROUPS[0]][2]['text'] == 'C' * 3600
    assert packet[GROUPS[0]][2]['text_truncated'] is True


def test_source_hash_or_chunk_mismatch_cannot_replace_recent_text():
    packet = context()
    packet['your_recent_tool_results'][0]['result']['sha256'] = 'c' * 64
    packet['your_recent_tool_results'][1]['result']['start'] = 121
    Engine._deduplicate_local_source_text(packet)
    assert packet['your_recent_tool_results'][0]['result']['text'] == 'A' * 8000
    assert packet['your_recent_tool_results'][1]['result']['text'] == 'B' * 6390


def test_synthetic_near_limit_context_shrinks_without_reducing_artifacts():
    packet = context()
    packet['other_context'] = 'M' * 12000
    before_size = len(json.dumps(packet, ensure_ascii=False).encode())
    compact = Engine._deduplicate_local_source_text(copy.deepcopy(packet))
    after_size = len(json.dumps(compact, ensure_ascii=False).encode())
    assert before_size > 85000
    assert after_size + 4033 + 2894 < 85000
    assert compact['relevant_artifacts'][0]['body'].endswith('CRITICAL_TAIL')


def test_tiny_duplicates_cannot_expand_context_near_limit():
    packet = context()
    for group in GROUPS:
        for evidence in packet[group]:
            evidence['text'] = 'x'
    for record in packet['your_recent_tool_results']:
        record['result']['text'] = 'x'
    packet['relevant_artifacts'] = []
    packet['other_context'] = 'M' * 80000
    before = copy.deepcopy(packet)
    compact = Engine._deduplicate_local_source_text(packet)
    assert compact == before
    assert len(json.dumps(compact).encode()) == len(json.dumps(before).encode())
