import copy
import json

import pytest

from swarm.store import BudgetError, Store
from fastapi.testclient import TestClient
from swarm.app import create_app


def test_renewal_preserves_usage_identity_and_survives_restart(tmp_path):
    store = Store(tmp_path)
    identity = store.runtime_identity()["store_id"]
    mission = store.create("Synthetic budget test", "live")["id"]
    call = store.reserve(mission, "data", "gemini", "fixture", 0.5)
    store.settle(call, cost=0.25)
    ledger = copy.deepcopy(store.ledger)
    result = store.renew_development_budget()
    assert result["pilot_limit_usd"] == 100
    assert result["remaining_pilot_usd"] == 99.75
    assert result["daily_limit_usd"] == 20
    assert store.ledger == ledger
    store.renew_development_budget()
    events = [json.loads(row[0]) for row in store._db.execute("SELECT data_json FROM events")]
    assert sum(e["type"] == "budget_authorization" for e in events) == 1
    store.close()
    reopened = Store(tmp_path)
    try:
        assert reopened.runtime_identity()["store_id"] == identity
        assert reopened.budget()["remaining_pilot_usd"] == 99.75
        assert reopened.ledger == ledger
        with pytest.raises(BudgetError):
            reopened.reserve(mission, "data", "gemini", "fixture", 100)
    finally:
        reopened.close()


def test_renewal_refuses_outstanding_and_expired_authorization(tmp_path, monkeypatch):
    store = Store(tmp_path)
    try:
        mission = store.create("Synthetic reservation", "live")["id"]
        call = store.reserve(mission, "data", "gemini", "fixture", 0.2)
        with pytest.raises(BudgetError, match="outstanding"):
            store.renew_development_budget()
        store.settle(call, cost=0)
        monkeypatch.setattr("swarm.store.local_day", lambda: "2026-10-28")
        with pytest.raises(BudgetError, match="expired"):
            store.renew_development_budget()
    finally:
        store.close()


def test_renewal_endpoint_requires_origin_and_idle_engine(tmp_path):
    app = create_app(tmp_path)
    with TestClient(app) as client:
        route = '/api/budget/authorize-development'
        assert client.post(route, headers={'Origin': 'https://untrusted.example'}).status_code == 403
        app.state.engine.active_id = 'synthetic-active'
        headers = {'Origin': 'http://testserver', 'Content-Type': 'application/json'}
        assert client.post(route, headers=headers).status_code == 400
        app.state.engine.active_id = None
        response = client.post(route, headers=headers)
        assert response.status_code == 200
        assert response.json()['pilot_limit_usd'] == 100
