"""Run a synthetic isolation probe through the actual Studio container runner."""
import json
from pathlib import Path

from swarm.studio import GitStudio


PROBE = '''import os
import socket
from pathlib import Path

def test_isolation():
    assert os.getuid() == 65534
    assert 'OPENAI_API_KEY' not in os.environ
    assert 'GEMINI_API_KEY' not in os.environ
    assert not Path('/var/run/docker.sock').exists()
    assert not Path('/host').exists()
    try:
        Path('/root-write-probe').write_text('probe')
    except OSError:
        pass
    else:
        raise AssertionError('Root filesystem was writable')
    sock = socket.socket()
    sock.settimeout(1)
    try:
        assert sock.connect_ex(('1.1.1.1', 443)) != 0
    finally:
        sock.close()
'''


if __name__ == '__main__':
    studio = GitStudio()
    draft = studio.draft('tests/test_swarm_isolation_probe.py', PROBE, 'coordinator')
    result = studio.run_tests([draft], draft['path'])
    result['checked_draft_sha256'] = draft['content_sha256']
    output = studio.root / '.swarm/reports/2026-09-28-container-probe.json'
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'passed' else 1)
