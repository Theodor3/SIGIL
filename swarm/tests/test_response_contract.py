import json
import subprocess
from types import SimpleNamespace
import pytest

from swarm.engine import Engine
from swarm.models import Assignment, Report
from swarm.providers import Providers
from swarm.response_contract import response_schema
from swarm.store import Store
from swarm.studio import GitStudio


def test_generation_contract_excludes_unknown_evidence_and_role_tools():
    original = Report.model_json_schema()
    visible = 'tool_0123456789abcdef'
    context = {'your_current_source_evidence': [
        {'id': visible, 'text': 'value = 1', 'text_truncated': False},
        {'id': 'tool_aaaaaaaaaaaaaaaa', 'text': 'partial', 'text_truncated': True},
    ], 'allowed_tools': ['read_file', 'search_code'],
        'allowed_recipients': ['coordinator'], 'independent_critique': True}
    result = response_schema(Report, json.dumps(context))
    defs = result['$defs']
    assert defs['StudioClaim']['properties']['tool_result_ids']['items']['enum'] == [visible]
    assert defs['StudioClaim']['properties']['tool_result_ids']['maxItems'] == 1
    assert 'draft_file' not in defs['ToolRequest']['properties']['tool']['enum']
    assert result['properties']['messages']['maxItems'] == 0
    assert result['properties']['source_requests']['maxItems'] == 0
    assert Report.model_json_schema() == original  # no cross-mission mutation


def test_coding_job_cannot_dispatch_without_test_runner(tmp_path):
    store = Store(tmp_path)
    try:
        mid = store.create('Write a tested change', 'live', requires_tests=True)['id']
        studio = SimpleNamespace(manifest=lambda: {'capabilities': {'run_pytest': False}})
        engine = Engine(store, Providers(), studio=studio)
        with pytest.raises(ValueError, match='isolated test image'):
            engine.start(mid)
        assert store.snapshot(mid)['mission']['status'] == 'ready'
        assert not store.ledger
    finally:
        store.close()


def test_no_source_read_does_not_offer_claims():
    result = response_schema(Report, json.dumps({'your_current_source_evidence': [],
        'allowed_tools': ['read_file'], 'mission_mode': 'local'}))
    assert result['properties']['studio_claims']['maxItems'] == 0
    assert result['properties']['source_requests']['maxItems'] == 0


def test_preload_reads_continuation_and_keeps_exact_evidence(tmp_path):
    root = tmp_path / 'repo'
    root.mkdir()
    (root / 'api').mkdir()
    content = ''.join(f'value_{i} = {i}\n' for i in range(151))
    (root / 'api/example.py').write_text(content, encoding='utf-8')
    def git(*args):
        subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True)
    git('init')
    git('add', '.')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture')
    studio = GitStudio(root)
    store = Store(tmp_path / 'runtime')
    try:
        mid = store.create('Read api/example.py', 'local')['id']
        data = store.get(mid)
        data['studio'] = {**studio.manifest(), 'files': list(studio.files)}
        store.save(data)
        engine = Engine(store, Providers(), studio=studio)
        engine._preload_sources(mid, Assignment(agent_id='engineering', task='Read api/example.py'), 'task_fixture')
        records = store.snapshot(mid)['tool_results']
        assert [(r['result']['start'], r['result']['end']) for r in records] == [(1, 120), (121, 151)]
        evidence = engine._source_evidence(records)
        assert engine._claims_cover_full_files(evidence)
        assert ''.join(r['text'] for r in evidence) == content
        assert all(r['task_id'] == 'task_fixture' and r['commit'] == studio.commit for r in evidence)
    finally:
        store.close()
