import json

import httpx
import pytest

from swarm.local import LocalProvider
from swarm.models import Report
from swarm.providers import ProviderFailure


@pytest.mark.parametrize('fault,expected', [
    (None, None), ('model', 'model identity'), ('length', 'output token limit'),
    ('content', 'schema validation'), ('usage', 'usage accounting'),
    ('http', 'HTTP 400'), ('json', 'response JSON'),
    ('structure', 'completion structure'), ('timeout', 'timed out'),
])
def test_local_contract_and_private_failure_details(monkeypatch, fault, expected):
    real_client = httpx.Client
    seen = []
    report = dict(summary='Checklist', artifact_title='Review', artifact_body='Check timing.',
                  messages=[], sources=[], source_requests=[], tool_requests=[], studio_claims=[])

    def handle(request):
        seen.append(request)
        payload = json.loads(request.content)
        assert payload['reasoning_effort'] == 'none'
        assert payload['max_tokens'] == 4000
        assert payload['response_format']['json_schema']['strict'] is True
        data = dict(model='sigil-local', choices=[dict(finish_reason='stop',
                    message=dict(content=json.dumps(report)))],
                    usage=dict(prompt_tokens=10, completion_tokens=20))
        if fault == 'model': data['model'] = 'private-wrong-model'
        if fault == 'length': data['choices'][0].update(finish_reason='length', message={'content': ''})
        if fault == 'content': data['choices'][0]['message']['content'] = 'private-invalid-content'
        if fault == 'usage': data['usage']['prompt_tokens'] = -1
        if fault == 'http': return httpx.Response(400, text='private-server-error')
        if fault == 'json': return httpx.Response(200, text='private-invalid-json')
        if fault == 'structure': data['choices'] = []
        if fault == 'timeout': raise httpx.ReadTimeout('private-timeout')
        return httpx.Response(200, json=data)

    def client(**kwargs):
        assert kwargs['trust_env'] is False
        assert kwargs['follow_redirects'] is False
        return real_client(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr('swarm.local.httpx.Client', client)
    provider = LocalProvider()
    provider.verified = True
    if fault:
        with pytest.raises(ProviderFailure) as caught:
            provider.run('system', 'prompt', Report)
        assert expected in str(caught.value)
        assert 'private' not in str(caught.value)
        assert not provider.verified
    else:
        result = provider.run('system', 'prompt', Report)
        assert result.returned_model == 'sigil-local'
        assert result.cost('local') == 0
        assert provider.verified
    assert len(seen) == 1
