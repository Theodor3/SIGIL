import pytest


@pytest.fixture(autouse=True)
def no_real_local_server_probe(monkeypatch):
    """Offline tests must not depend on the owner's running model server."""
    monkeypatch.setattr("swarm.local.LocalProvider.status", lambda self: {
        "configured": False, "verified": False, "model": "sigil-local",
    })
