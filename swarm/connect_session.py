"""Connect the owner's existing env-file keys to the verified loopback server.

No credential values are written, logged, exported, or passed on the command line.
"""
import argparse
from pathlib import Path
import re

import httpx

URL = 'http://127.0.0.1:8765'
WORKSPACE = Path(__file__).resolve().parent.parent


def connect_session(env_file, *, transport=None):
    with httpx.Client(base_url=URL, trust_env=False, follow_redirects=False,
                      timeout=15, transport=transport,
                      headers={'Origin': URL, 'Content-Type': 'application/json'}) as client:
        response = client.get('/api/health')
        response.raise_for_status()
        health = response.json()
        if health.get('app') != 'sigil-swarm' or Path(health.get('workspace', '')).resolve() != WORKSPACE:
            raise ValueError('The server identity does not match this checkout.')
        response = client.get('/api/state')
        response.raise_for_status()
        if response.json().get('active_mission_id'):
            raise ValueError('Wait for the active mission before reconnecting.')
        keys = {}
        for line in Path(env_file).read_text(encoding='utf-8-sig').splitlines():
            match = re.match(r'^\s*(?:export\s+)?(OPENAI_API_KEY|GEMINI_API_KEY)\s*=\s*(.*?)\s*$', line)
            if match:
                keys[match[1].lower()] = match[2].strip().strip('"').strip("'")
        if len(keys) != 2 or any(not value or any(c.isspace() for c in value) for value in keys.values()):
            raise ValueError('Both key entries must be nonempty and contain no whitespace.')
        response = client.post('/api/providers', json=keys)
        response.raise_for_status()
        status = response.json()
        if not all(status.get(p, {}).get('configured') for p in ('openai', 'gemini')):
            raise ValueError('Both session connections were not confirmed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', type=Path, required=True)
    args = parser.parse_args()
    try:
        connect_session(args.env_file)
    except Exception as exc:
        print('Session connection stopped (' + type(exc).__name__ + '). Credential values withheld.')
        raise SystemExit(1)
    print('Both providers connected to the verified local session. No paid call was made.')
