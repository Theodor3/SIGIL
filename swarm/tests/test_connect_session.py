import json

import httpx
import pytest

from swarm.connect_session import WORKSPACE, connect_session


@pytest.mark.parametrize('trusted', [True, False])
def test_keys_go_only_to_verified_idle_local_server(tmp_path, trusted):
    env_file = tmp_path / '.env'
    env_file.write_text('OPENAI_API_KEY=synthetic-openai\nGEMINI_API_KEY=synthetic-gemini\n')
    requests = []
    def respond(request):
        requests.append(request)
        assert request.url.host == '127.0.0.1'
        if request.url.path == '/api/health':
            return httpx.Response(200, json={'app': 'sigil-swarm',
                'workspace': str(WORKSPACE if trusted else tmp_path)})
        if request.url.path == '/api/state':
            return httpx.Response(200, json={'active_mission_id': None})
        assert request.url.path == '/api/providers'
        assert request.headers['Origin'] == 'http://127.0.0.1:8765'
        assert json.loads(request.content) == {'openai_api_key':'synthetic-openai', 'gemini_api_key':'synthetic-gemini'}
        return httpx.Response(200, json={'openai':{'configured':True}, 'gemini':{'configured':True}})
    if trusted:
        connect_session(env_file, transport=httpx.MockTransport(respond))
        assert len(requests) == 3
    else:
        with pytest.raises(ValueError, match='identity'):
            connect_session(env_file, transport=httpx.MockTransport(respond))
        assert len(requests) == 1
