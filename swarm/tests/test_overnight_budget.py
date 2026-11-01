import copy
import json

import pytest
from fastapi.testclient import TestClient

from swarm.app import create_app
from swarm.store import BudgetError, Store


def clock(monkeypatch, day, instant):
    monkeypatch.setattr("swarm.store.local_day", lambda: day)
    monkeypatch.setattr("swarm.store.now", lambda: instant)


def prepared(tmp_path, monkeypatch):
    clock(monkeypatch, "2026-10-27", "2026-10-27T23:00:00-04:00")
    store = Store(tmp_path)
    store.renew_development_budget()
    mission = store.create("Synthetic overnight cap", "live")["id"]
    return store, mission


def test_cap_survives_midnight_and_stop_is_exact(tmp_path, monkeypatch):
    store, mission = prepared(tmp_path, monkeypatch)
    try:
        store.authorize_overnight_budget()
        call = store.reserve(mission, "data", "gemini", "fixture", 12)
        store.settle(call, cost=12)
        clock(monkeypatch, "2026-10-28", "2026-10-28T00:01:00-04:00")
        assert not store.budget()["expired"]
        assert store.budget()["remaining_today_usd"] == 8
        with pytest.raises(BudgetError, match="exceed"):
            store.reserve(mission, "data", "gemini", "fixture", 8.01)
        call = store.reserve(mission, "data", "gemini", "fixture", 8)
        assert store.budget()["overnight"]["remaining_usd"] == 0
        store.settle(call, cost=7)
        clock(monkeypatch, "2026-10-28", "2026-10-28T08:00:00-04:00")
        with pytest.raises(BudgetError, match="expired"):
            store.reserve(mission, "data", "gemini", "fixture", 0.01)
    finally:
        store.close()


def test_authorization_is_idempotent_and_preserves_history_on_restart(tmp_path, monkeypatch):
    store, mission = prepared(tmp_path, monkeypatch)
    old_call = store.reserve(mission, "data", "gemini", "fixture", 1)
    store.settle(old_call, cost=1)
    history = copy.deepcopy(store.ledger)
    identity = store.store_id
    store.authorize_overnight_budget()
    new_call = store.reserve(mission, "data", "gemini", "fixture", 2)
    store.settle(new_call, cost=2)
    assert store.authorize_overnight_budget()["overnight"]["remaining_usd"] == 18
    assert store.ledger[:1] == history
    events = [json.loads(row[0]) for row in store._db.execute("SELECT data_json FROM events")]
    assert sum(e["type"] == "overnight_budget_authorization" for e in events) == 1
    store.close()
    store = Store(tmp_path)
    try:
        assert store.store_id == identity
        assert store.budget()["overnight"]["remaining_usd"] == 18
        assert store.budget()["pilot_usd"] == 3
        assert store.settings["pilot_limit_usd"] == 100
        assert store.settings["expires_on"] == "2026-10-28"
    finally:
        store.close()


def test_refuses_outstanding_billing_and_cumulative_cap_still_applies(tmp_path, monkeypatch):
    store, mission = prepared(tmp_path, monkeypatch)
    try:
        call = store.reserve(mission, "data", "gemini", "fixture", 1)
        with pytest.raises(BudgetError, match="outstanding"):
            store.authorize_overnight_budget()
        store.settle(call, cost=0)
        store.settings["pilot_limit_usd"] = 3
        store.authorize_overnight_budget()
        with pytest.raises(BudgetError, match="exceed"):
            store.reserve(mission, "data", "gemini", "fixture", 3.01)
        call = store.reserve(mission, "data", "gemini", "fixture", 2)
        store.settle(call)  # uncertain billing must retain the reservation
        assert store.budget()["overnight"]["remaining_usd"] == 18
        with pytest.raises(BudgetError, match="uncertain"):
            store.reserve(mission, "data", "gemini", "fixture", 0.1)
    finally:
        store.close()


def test_no_implicit_activation_or_late_renewal(tmp_path, monkeypatch):
    store, _ = prepared(tmp_path, monkeypatch)
    try:
        assert store.budget()["overnight"] is None
        clock(monkeypatch, "2026-10-28", "2026-10-28T08:00:00-04:00")
        assert store.budget()["expired"]
        with pytest.raises(BudgetError, match="window"):
            store.authorize_overnight_budget()
    finally:
        store.close()


def test_endpoint_requires_origin_and_idle_engine(tmp_path, monkeypatch):
    clock(monkeypatch, "2026-10-27", "2026-10-27T23:00:00-04:00")
    app = create_app(tmp_path)
    with TestClient(app) as client:
        headers = {"Origin": "http://testserver", "Content-Type": "application/json"}
        client.post("/api/budget/authorize-development", headers=headers).raise_for_status()
        route = "/api/budget/authorize-overnight"
        assert client.post(route, headers={"Origin": "https://untrusted.example"}).status_code == 403
        app.state.engine.active_id = "synthetic"
        assert client.post(route, headers=headers).status_code == 400
        app.state.engine.active_id = None
        response = client.post(route, headers=headers)
        assert response.status_code == 200
        assert response.json()["overnight"]["remaining_usd"] == 20
