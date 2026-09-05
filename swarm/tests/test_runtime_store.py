import hashlib
import json
import sqlite3

import pytest

from swarm.models import DAILY_LIMIT, GEMINI_MODEL, PILOT_LIMIT
from swarm.store import Store


MID = "m_0123456789abcdef"


def legacy_mission(prompt="Legacy mission"):
    created = "2026-09-04T12:00:00+00:00"
    return {
        "mission": {
            "id": MID, "title": prompt, "prompt": prompt, "mode": "live",
            "status": "completed", "created_at": created, "updated_at": created,
            "round": 1, "max_rounds": 5, "spent_usd": 0.0,
            "summary": "Saved result", "peer_rounds": 0,
        },
        "messages": [], "tasks": [], "artifacts": [], "calls": [],
        "pending_assignments": [], "sources": [], "tool_results": [],
        "drafts": [], "studio": None,
    }


def write_legacy_runtime(root):
    mission = legacy_mission()
    call = {
        "id": "call_0123456789abcdef", "mission_id": MID, "task_id": "task_one",
        "agent_id": "data", "provider": "gemini", "model": GEMINI_MODEL,
        "status": "completed", "created_at": "2026-09-04T12:01:00+00:00",
        "finished_at": "2026-09-04T12:02:00+00:00", "day": "2026-09-04",
        "reservation_usd": 0.2, "cost_usd": 0.123,
        "usage": {"input_tokens": 100, "output_tokens": 20},
    }
    event = {
        "id": "evt_0123456789abcdef", "at": "2026-09-04T12:00:00+00:00",
        "type": "message", "mission_id": MID,
        "message": {"id": "msg_0123456789abcdef", "text": "Legacy event"},
    }
    (root / f"{MID}.json").write_text(json.dumps(mission), encoding="utf-8")
    (root / "budget.json").write_text(json.dumps([call]), encoding="utf-8")
    (root / "pilot.json").write_text(json.dumps({
        "started_on": "2026-09-04", "expires_on": "2099-01-01",
        "daily_limit_usd": DAILY_LIMIT * 10, "pilot_limit_usd": PILOT_LIMIT * 10,
    }), encoding="utf-8")
    (root / "messages.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")


def test_legacy_runtime_migrates_once_with_checked_backup(tmp_path):
    write_legacy_runtime(tmp_path)
    legacy_hashes = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in tmp_path.glob("*.json*")
    }

    store = Store(tmp_path)
    first_identity = store.runtime_identity()
    try:
        assert first_identity["schema_version"] == 1
        assert first_identity["journal_mode"] == "wal"
        assert store.snapshot(MID)["mission"]["summary"] == "Saved result"
        assert store.snapshot(MID)["mission"]["spent_usd"] == 0.123
        assert store.budget()["daily_limit_usd"] == DAILY_LIMIT
        assert store.budget()["pilot_limit_usd"] == PILOT_LIMIT

        backup = next(tmp_path.glob("legacy-json-backup-*"))
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        recorded = {item["name"]: item["sha256"] for item in manifest["files"]}
        assert recorded == legacy_hashes

        connection = sqlite3.connect(tmp_path / "swarm.sqlite3")
        try:
            assert connection.execute("PRAGMA user_version").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM missions").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM calls").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
        finally:
            connection.close()
    finally:
        store.close()

    # The database is authoritative after migration; stale legacy files are not re-imported.
    changed = legacy_mission("Changed legacy file")
    (tmp_path / f"{MID}.json").write_text(json.dumps(changed), encoding="utf-8")
    reopened = Store(tmp_path)
    try:
        assert reopened.runtime_identity()["store_id"] == first_identity["store_id"]
        assert reopened.snapshot(MID)["mission"]["prompt"] == "Legacy mission"
        assert len(list(tmp_path.glob("legacy-json-backup-*"))) == 1
    finally:
        reopened.close()


def test_sqlite_persists_new_messages_and_task_scoped_calls(tmp_path):
    first = Store(tmp_path)
    mission_id = first.create("Persist the whole run", "live")["id"]
    message = first.message(mission_id, "data", "coordinator", "Observed limitation")
    call_id = first.reserve(
        mission_id, "data", "gemini", GEMINI_MODEL, 0.2, task_id="task_persisted"
    )
    first.settle(
        call_id, cost=0.01, usage={"input_tokens": 2, "output_tokens": 1},
        returned_model=GEMINI_MODEL,
    )
    first.close()

    second = Store(tmp_path)
    try:
        snapshot = second.snapshot(mission_id)
        assert any(item["id"] == message["id"] for item in snapshot["messages"])
        assert snapshot["calls"][0]["task_id"] == "task_persisted"
        assert snapshot["mission"]["spent_usd"] == 0.01
    finally:
        second.close()


def test_invalid_legacy_data_fails_without_holding_controller_lock(tmp_path):
    (tmp_path / "pilot.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        Store(tmp_path)
    (tmp_path / "pilot.json").write_text(json.dumps({
        "started_on": "2026-09-04", "expires_on": "2099-01-01",
        "daily_limit_usd": DAILY_LIMIT, "pilot_limit_usd": PILOT_LIMIT,
    }), encoding="utf-8")
    recovered = Store(tmp_path)
    recovered.close()
