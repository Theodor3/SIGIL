import json
from types import SimpleNamespace

import pytest

from swarm.engine import Engine
from swarm.models import ToolRequest
from swarm.sources import validate_url
from swarm.store import Store
from swarm.tooling import MissionTools


@pytest.fixture
def setup(tmp_path, monkeypatch):
    store = Store(tmp_path)
    mid = store.create('Read public research', 'local')['id']
    studio = SimpleNamespace(files={})
    calls = []
    def fetch(url):
        calls.append(url)
        return dict(status='retrieved', url=url, title='Fixture', text='Public evidence',
                    fetched_at='2026-10-04', sha256='a' * 64)
    monkeypatch.setattr('swarm.tooling.fetch_source', fetch)
    monkeypatch.setattr('swarm.tooling.paper_search', lambda q: dict(status='retrieved', results=[], query=q))
    yield store, mid, studio, MissionTools(store, None, studio), calls
    store.close()


def test_local_free_tools_and_limits(setup):
    store, mid, studio, tools, calls = setup
    before = store.budget()
    for i in range(7):
        r = tools.execute(mid, 'data', ToolRequest(tool='fetch_page', query='https://www.stb.gov/'), lambda: None)
        assert r['status'] == ('completed' if i < 6 else 'blocked')
    assert len(calls) == 6
    for i in range(5):
        r = tools.execute(mid, 'data', ToolRequest(tool='paper_search', query='rail congestion'), lambda: None)
        assert r['status'] == ('completed' if i < 4 else 'blocked')
    r = tools.execute(mid, 'data', ToolRequest(tool='web_search', query='rail congestion'), lambda: None)
    assert r['status'] == 'blocked'
    assert store.budget() == before
    assert store.snapshot(mid)['calls'] == []


@pytest.mark.parametrize('role', ['data', 'review'])
def test_private_source_blocks_outbound_even_if_requested_directly(setup, role):
    store, mid, studio, tools, calls = setup
    store.get(mid)['tool_results'] = [dict(id='read', agent_id='data', tool='read_file',
        status='completed', result={}, summary='Private read')]
    for tool in ('fetch_page', 'paper_search'):
        r = tools.execute(mid, role, ToolRequest(tool=tool, query='https://www.stb.gov/'), lambda: None)
        assert r['status'] == 'blocked'
    assert calls == []


def test_public_tools_advertised_without_paid_search(setup):
    store, mid, studio, tools, calls = setup
    prompt, _ = Engine(store, None, studio=studio)._context(mid, 'data', 'Read public page')
    allowed = json.loads(prompt)['allowed_tools']
    assert 'fetch_page' in allowed and 'paper_search' in allowed
    assert 'read_file' in allowed and 'web_search' not in allowed


def test_copied_source_cannot_be_sent_in_fetch_url(setup):
    store, mid, studio, tools, calls = setup
    line = 'private_project_identifier_that_should_not_leave_the_machine'
    studio.files = {'api/example.py': line}
    r = tools.execute(mid, 'data', ToolRequest(tool='fetch_page', query='https://www.stb.gov/?q=' + line), lambda: None)
    assert r['status'] == 'blocked'
    assert calls == []
    assert line not in r['query']


@pytest.mark.parametrize('url', ['http://www.stb.gov/', 'https://127.0.0.1/',
    'https://www.stb.gov.evil.example/', 'https://' + 'user:pass' + '@www.stb.gov/', 'https://www.stb.gov:8765/'])
def test_public_reader_rejects_unsafe_addresses(url):
    with pytest.raises(ValueError): validate_url(url, resolve=False)


def test_research_hosts_approved():
    for url in ('https://www.stb.gov/', 'https://www.csx.com/'):
        assert validate_url(url, resolve=False) == url
