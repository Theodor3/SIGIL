"""Finite explicit sessions with synthetic providers; never generate model output."""
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from swarm.queue import BoundedQueue, MAX_MISSION_SECONDS
from swarm.store import Store


class FakeEngine:
    def __init__(self, store):
        self.store = store
        self.lock = threading.RLock()
        self.active_id = None
        self.started, self.stopped = [], []
        self.local_available = True
        self.api_available = True
        self.current = True
        self.tests = True
        self.studio = SimpleNamespace(manifest=lambda: {
            "is_current": self.current, "capabilities": {"run_pytest": self.tests}})
        self.providers = SimpleNamespace(
            local=SimpleNamespace(status=lambda: {"configured": self.local_available}),
            public_status=lambda: {name: {"configured": self.api_available} for name in ("openai", "gemini")})

    def start(self, identity, *, max_runtime_seconds):
        assert self.active_id is None
        assert 0 < max_runtime_seconds <= MAX_MISSION_SECONDS
        self.started.append((identity, max_runtime_seconds))
        self.active_id = identity
        record = self.store.get(identity)
        record["mission"]["status"] = "running"
        record["mission"]["round"] = 1
        record["mission"]["deadline_at"] = (datetime.now(timezone.utc) + timedelta(seconds=max_runtime_seconds)).isoformat()
        self.store.save(record)
        return self.store.snapshot(identity)["mission"]

    def stop(self, identity):
        self.stopped.append(identity)
        if self.active_id == identity:
            self.active_id = None
            record = self.store.get(identity)
            record["mission"]["status"] = "stopped"
            self.store.save(record)


@pytest.fixture
def queue(tmp_path):
    folder = tmp_path / ".swarm"
    folder.mkdir()
    (folder / "board.json").write_text(json.dumps({"tasks": [], "unrelated": {"keep": "exact value"}}))
    (folder / "company.json").write_text("{}")
    store = Store(tmp_path / "runtime")
    engine = FakeEngine(store)
    controller = BoundedQueue(engine, store, tmp_path)
    controller._start_thread = lambda identity: None
    yield controller
    controller.shutdown()
    store.close()


def prepare(queue, mode="local", **fields):
    return queue.prepare({"prompt": "An explicit independent assignment", "mode": mode, **fields})["mission"]["id"]


def finish(queue, identity, disposition=None):
    queue.engine.active_id = None
    record = queue.store.get(identity)
    record["mission"]["status"] = "needs_review"
    if disposition:
        record["mission"]["review_resolution"] = {"disposition": disposition, "reviewer": "codex"}
    queue.store.save(record)


def test_off_by_default_restart_never_resumes(queue):
    identity = prepare(queue)
    assert queue.status()["state"] == "off"
    assert queue._thread is None
    assert not queue.engine.started
    another = BoundedQueue(queue.engine, queue.store, queue.root)
    assert another.status()["enabled"] is False
    assert another.inventory()["missions"][0]["id"] == identity


def test_explicit_prepare_preserves_board_and_exact_backup(queue):
    original = queue.board_path.read_bytes()
    result = queue.prepare({"prompt": "Narrow source audit"})
    board = json.loads(queue.board_path.read_bytes())
    assert board["unrelated"] == {"keep": "exact value"}
    assert board["tasks"][0]["missionId"] == result["mission"]["id"]
    assert board["tasks"][0]["runtimeSpecSha256"]
    assert board["tasks"][0]["queuePreparedFromSha256"]
    backups = list(queue.board_path.parent.glob(".queue-board-backup-*.json"))
    assert len(backups) == 1 and backups[0].read_bytes() == original
    assert queue.inventory()["missions"][0]["eligible"] is True
    assert queue.inventory()["board"]["ready_count"] == 1


@pytest.mark.parametrize("broken", [None, "not json", '{"tasks":[{"id":"x","status":"bogus"}]}'])
def test_missing_or_corrupt_board_blocks_without_hidden_creation(queue, broken):
    if broken is None:
        queue.board_path.unlink()
    else:
        queue.board_path.write_text(broken)
    before = len(queue.store.summaries())
    with pytest.raises(ValueError, match="board"):
        queue.prepare({"prompt": "No hidden task"})
    assert len(queue.store.summaries()) == before
    assert queue.inventory()["board"]["error"]


def test_observed_board_race_preserves_editor_and_orphan_is_ineligible(queue, monkeypatch):
    original_write = queue._write_board
    edited = {"tasks": [], "editor": "preserve me"}
    def concurrent_write(original, board):
        queue.board_path.write_text(json.dumps(edited))
        original_write(original, board)
    monkeypatch.setattr(queue, "_write_board", concurrent_write)
    with pytest.raises(ValueError, match="not queue-eligible"):
        queue.prepare({"prompt": "Orphan remains visible"})
    assert json.loads(queue.board_path.read_text()) == edited
    mission = queue.store.summaries()[0]
    assert mission["status"] == "ready" and mission["queue_board_link_error"]
    assert queue.inventory()["missions"][0]["eligible"] is False


@pytest.mark.parametrize("options", [
    {"ids": []}, {"ids": "m_" + "1" * 16}, {"ids": ["m_" + "1" * 16] * 2},
    {"mode": "subscription"}, {"mode": "demo"}, {"duration_minutes": 0},
    {"duration_minutes": 61}, {"duration_minutes": True}, {"cadence_minutes": 0},
    {"cadence_minutes": 61}, {"cadence_minutes": 1.0}, {"paid_confirmed": "yes"},
])
def test_class_rejects_unbounded_or_implicit_inputs(queue, options):
    identity = prepare(queue)
    fields = {"ids": [identity], **options}
    with pytest.raises(ValueError):
        queue.start(**fields)
    assert not queue.engine.started and queue.status()["enabled"] is False


def test_paid_requires_confirmation_and_homogeneous_selection(queue):
    local = prepare(queue)
    paid = prepare(queue, "live")
    with pytest.raises(ValueError, match="paid confirmation"):
        queue.start([paid], mode="live")
    with pytest.raises(ValueError, match="match"):
        queue.start([local, paid], mode="local")
    queue.start([paid], mode="live", paid_confirmed=True)
    queue._tick()
    assert queue.engine.started[0][0] == paid


def test_unlinked_runtime_mission_is_never_eligible(queue):
    mission = queue.store.create("Explicit API ready but no board link", "local")
    assert queue.inventory()["missions"][0]["eligible"] is False
    with pytest.raises(ValueError, match="board link"):
        queue.start([mission["id"]])


@pytest.mark.parametrize("mutation", ["mission", "user_message", "board", "board_missing", "company", "provider", "studio", "tests"])
def test_every_dispatch_rechecks_frozen_spec_and_readiness(queue, mutation):
    identity = prepare(queue, requires_tests=mutation == "tests")
    queue.start([identity])
    if mutation == "mission":
        queue.store.get(identity)["mission"]["prompt"] = "Changed task"
    elif mutation == "user_message":
        queue.store.message(identity, "user", "coordinator", "New execution instruction", "question")
    elif mutation == "board":
        board = json.loads(queue.board_path.read_text())
        board["tasks"][0]["title"] = "Changed after enable"
        queue.board_path.write_text(json.dumps(board))
    elif mutation == "board_missing":
        queue.board_path.unlink()
    elif mutation == "company":
        (queue.board_path.parent / "company.json").write_text("not valid JSON")
    elif mutation == "provider":
        queue.engine.local_available = False
    elif mutation == "studio":
        queue.engine.current = False
    elif mutation == "tests":
        queue.engine.tests = False
    queue._tick()
    assert queue.status()["state"] == "blocked"
    assert not queue.engine.started


@pytest.mark.parametrize("budget_key,value", [("uncertain", True), ("expired", True), ("remaining_today_usd", 0), ("remaining_pilot_usd", 0)])
def test_api_budget_rechecked_before_dispatch(queue, monkeypatch, budget_key, value):
    identity = prepare(queue, "live")
    queue.start([identity], mode="live", paid_confirmed=True)
    budget = queue.store.budget()
    budget[budget_key] = value
    monkeypatch.setattr(queue.store, "budget", lambda: budget)
    queue._tick()
    assert not queue.engine.started
    assert queue.status()["state"] == "blocked"


def test_one_job_then_waits_for_external_review_and_cadence(queue):
    first, second = prepare(queue), prepare(queue)
    queue.start([first, second], duration_minutes=5, cadence_minutes=1)
    queue._tick()
    assert [item[0] for item in queue.engine.started] == [first]
    assert queue.engine.started[0][1] <= 300
    queue._tick()
    assert len(queue.engine.started) == 1
    finish(queue, first)
    queue._tick()
    assert queue.status()["state"] == "waiting_review"
    finish(queue, first, "rejected")
    queue._tick()
    assert queue.status()["state"] == "waiting_cadence"
    queue._next_dispatch = 0
    queue._tick()
    assert [item[0] for item in queue.engine.started] == [first, second]


def test_global_unresolved_review_waits_before_first_job(queue):
    previous = queue.store.create("Previous unrelated evidence", "local")["id"]
    finish(queue, previous)
    identity = prepare(queue)
    queue.start([identity])
    queue._tick()
    assert queue.status()["state"] == "waiting_review"
    assert not queue.engine.started
    finish(queue, previous, "reviewed")
    queue._tick()
    assert queue.engine.started[0][0] == identity


def test_evidence_blocked_stops_and_never_refills(queue):
    first, second = prepare(queue), prepare(queue)
    queue.start([first, second])
    queue._tick()
    finish(queue, first, "evidence_blocked")
    queue._tick()
    assert queue.status()["state"] == "blocked"
    assert not queue.status()["enabled"]
    queue._tick()
    assert len(queue.engine.started) == 1


@pytest.mark.parametrize("clock", ["monotonic", "wall"])
def test_expiry_stops_only_owned_active_job(queue, clock):
    identity = prepare(queue)
    queue.start([identity], duration_minutes=1)
    queue._tick()
    if clock == "monotonic":
        queue._mono_deadline = time.monotonic() - 1
    else:
        queue._wall_deadline = datetime.now(timezone.utc) - timedelta(seconds=1)
    queue._tick()
    assert queue.status()["state"] == "expired"
    assert queue.engine.stopped == [identity]


def test_stop_or_expiry_never_stops_unrelated_active(queue):
    identity = prepare(queue)
    unrelated = queue.store.create("Unrelated active", "local")["id"]
    queue.engine.active_id = unrelated
    queue.start([identity], duration_minutes=1)
    queue._tick()
    assert queue.status()["state"] == "waiting_active"
    queue._mono_deadline = time.monotonic() - 1
    queue._tick()
    queue.stop()
    assert not queue.engine.stopped and queue.engine.active_id == unrelated


def test_no_replay_after_completed_review_and_session_restart(queue):
    identity = prepare(queue)
    queue.start([identity])
    queue._tick()
    finish(queue, identity, "reviewed")
    queue._tick()
    assert queue.status()["state"] == "completed"
    with pytest.raises(ValueError, match="undispatched"):
        queue.start([identity])
    assert len(queue.engine.started) == 1


def test_session_and_dispatch_audit_events_are_recorded_without_prompt(queue):
    identity = prepare(queue)
    queue.start([identity])
    queue._tick()
    queue.stop()
    rows = queue.store._db.execute("SELECT data_json FROM events").fetchall()
    events = [json.loads(row[0]) for row in rows]
    queue_events = [event for event in events if event["type"].startswith("queue_")]
    assert {event["type"] for event in queue_events} >= {
        "queue_mission_prepared", "queue_session_started", "queue_mission_dispatched", "queue_session_finished"}
    assert all("prompt" not in event for event in queue_events)


def test_inventory_probes_each_runtime_capability_once(queue, monkeypatch):
    for _ in range(3):
        prepare(queue)
    counts = {"studio": 0, "budget": 0, "local": 0}
    original_budget = queue.store.budget
    def studio():
        counts["studio"] += 1
        return {"is_current": True, "capabilities": {"run_pytest": True}}
    def local():
        counts["local"] += 1
        return {"configured": True}
    def budget():
        counts["budget"] += 1
        return original_budget()
    monkeypatch.setattr(queue.engine.studio, "manifest", studio)
    monkeypatch.setattr(queue.engine.providers.local, "status", local)
    monkeypatch.setattr(queue.store, "budget", budget)
    assert all(mission["eligible"] for mission in queue.inventory()["missions"])
    assert counts == {"studio": 1, "budget": 1, "local": 1}


def test_final_spec_check_and_engine_start_share_store_lock(queue, monkeypatch):
    identity = prepare(queue)
    queue.start([identity])
    original = queue.engine.start
    def guarded(identity, **kwargs):
        assert queue.store.lock._is_owned()
        return original(identity, **kwargs)
    monkeypatch.setattr(queue.engine, "start", guarded)
    queue._tick()
    assert queue.engine.started[0][0] == identity
