"""Explicit, finite queue sessions over ready missions; off after every restart."""
import copy
import hashlib
import json
import os
import re
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .engine import MAX_MISSION_SECONDS
from .models import MAX_ROUNDS
from .store import now, uid
from .review_status import review_flags

BOARD_LIMIT = 2_000_000
STATES = {"ready", "assigned", "review", "blocked", "done", "rejected"}
SPEC_FIELDS = ("id", "prompt", "mode", "local_role", "requires_tests", "max_revisions",
               "max_rounds", "specialist_execution", "max_cost_usd")


def _hash(value):
    return hashlib.sha256(value).hexdigest()


def _spec(mission):
    return _hash(json.dumps({key: mission.get(key) for key in SPEC_FIELDS},
                           sort_keys=True, ensure_ascii=False).encode())


@contextmanager
def _cooperative_lock(path):
    """Serialize queue writers; external editors are checked before replacement."""
    with path.open("a+b") as handle:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            if not handle.read(1):
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise ValueError("Another queue writer holds the board lock.") from None
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                raise ValueError("Another queue writer holds the board lock.") from None
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)


class BoundedQueue:
    def __init__(self, engine, store, root):
        self.engine, self.store = engine, store
        self.root = Path(root).resolve()
        self.board_path = self.root / ".swarm" / "board.json"
        self.lock = threading.RLock()
        self._thread = None
        self._wake = threading.Event()
        self._mono_deadline = None
        self._wall_deadline = None
        self._next_dispatch = 0
        self._frozen = {}
        self._last_owned = None
        self._session = {"enabled": False, "running": False, "state": "off", "id": None,
                         "mode": "local", "mission_ids": [], "pending_ids": [],
                         "owned_active_id": None, "last_error": None, "expires_at": None,
                         "started_at": None, "cadence_minutes": None, "duration_minutes": None}

    def _board(self):
        if (self.board_path.is_symlink() or self.board_path.parent.is_symlink()
                or self.board_path.resolve().parent != self.root / ".swarm"
                or not self.board_path.is_file()):
            raise ValueError("The canonical board is missing or is a symbolic link.")
        try:
            raw = self.board_path.read_bytes()
            if len(raw) > BOARD_LIMIT:
                raise ValueError()
            board = json.loads(raw)
            tasks = board["tasks"]
            if not isinstance(board, dict) or not isinstance(tasks, list):
                raise ValueError()
            ids = []
            for task in tasks:
                if (not isinstance(task, dict) or not isinstance(task.get("id"), str)
                        or not task["id"] or task.get("status") not in STATES):
                    raise ValueError()
                ids.append(task["id"])
            if len(ids) != len(set(ids)):
                raise ValueError()
        except (OSError, ValueError, KeyError, TypeError, UnicodeError):
            raise ValueError("The canonical board is unreadable, oversized or invalid.") from None
        return board, raw

    def _company(self):
        path = self.board_path.parent / "company.json"
        try:
            if (path.is_symlink() or path.resolve().parent != self.root / ".swarm"
                    or not path.is_file()):
                raise ValueError()
            raw = path.read_bytes()
            if len(raw) > 256_000 or not isinstance(json.loads(raw), dict):
                raise ValueError()
        except (OSError, ValueError, TypeError, UnicodeError):
            raise ValueError("The canonical company record is missing, unreadable or invalid.") from None
        # Operational context only. Historical company caps never replace the
        # current Store ledger, readiness controls or explicit session bounds.
        return _hash(raw)

    def _write_board(self, original, board):
        """Atomic replacement plus observed-change guard, not an editor transaction."""
        replacement = (json.dumps(board, indent=2, ensure_ascii=False) + "\n").encode()
        if len(replacement) > BOARD_LIMIT:
            raise ValueError("The prepared board exceeds its size bound.")
        temporary = None
        try:
            with _cooperative_lock(self.board_path.parent / ".queue-board.lock"):
                if self._board()[1] != original:
                    raise ValueError("The board changed while the mission was prepared; no board replacement made.")
                backup = self.board_path.parent / (".queue-board-backup-" + uid("b") + ".json")
                with backup.open("xb") as stream:
                    stream.write(original)
                    stream.flush()
                    os.fsync(stream.fileno())
                with tempfile.NamedTemporaryFile(dir=self.board_path.parent,
                        prefix=".queue-board-", suffix=".tmp", delete=False) as stream:
                    temporary = Path(stream.name)
                    stream.write(replacement)
                    stream.flush()
                    os.fsync(stream.fileno())
                # A non-cooperating editor can still race this final check. Never
                # replace an observed mismatch; preserve the exact original backup.
                if self._board()[1] != original:
                    raise ValueError("The board changed before replacement; no board replacement made.")
                os.replace(temporary, self.board_path)
                temporary = None
        except OSError:
            raise ValueError("The board update could not be written atomically.") from None
        finally:
            if temporary is not None:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError:
                    pass

    def prepare(self, payload):
        allowed = {"prompt", "mode", "local_role", "max_revisions", "specialist_execution",
                   "requires_tests", "max_cost_usd"}
        if not isinstance(payload, dict) or set(payload) - allowed:
            raise ValueError("Choose only the supported mission preparation fields.")
        fields = dict(payload)
        mode = fields.pop("mode", "local")
        prompt = fields.pop("prompt", None)
        if mode not in ("local", "live") or not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 6000:
            raise ValueError("Prepare a nonempty local or API assignment of at most 6000 characters.")
        if "requires_tests" in fields and type(fields["requires_tests"]) is not bool:
            raise ValueError("The test requirement must be a boolean.")
        revisions = fields.get("max_revisions", 0)
        if type(revisions) is not int or not 0 <= revisions < MAX_ROUNDS:
            raise ValueError("Choose a bounded integer revision allowance.")
        fields.setdefault("max_revisions", 0)
        if fields.get("specialist_execution", "parallel") not in ("parallel", "sequential"):
            raise ValueError("Choose a supported specialist execution order.")
        with self.engine.lock, self.lock, self.store.lock:
            board, original = self._board()
            company_hash = self._company()
            mission = self.store.create(prompt, mode, **fields)
            task = {"id": uid("queue"), "owner": "coordinator", "title": mission["title"],
                    "status": "ready", "assignment": mission["prompt"], "missionId": mission["id"],
                    "queuePreparedAt": now(), "queuePreparedFromSha256": _hash(original),
                    "queuePreparedCompanySha256": company_hash,
                    "runtimeSpecSha256": _spec(mission)}
            board["tasks"].append(task)
            board["updated"] = datetime.now(timezone.utc).date().isoformat()
            try:
                self._write_board(original, board)
            except ValueError as exc:
                with self.store.lock:
                    data = self.store.get(mission["id"])
                    data["mission"]["queue_board_link_error"] = str(exc)
                    self.store.save(data)
                raise ValueError(f"Mission {mission['id']} was prepared but is not queue-eligible: {exc}") from None
            self.store.event("queue_mission_prepared", mission_id=mission["id"], board_task_id=task["id"],
                             observed_board_sha256=task["queuePreparedFromSha256"],
                             observed_company_sha256=company_hash)
            return {"mission": mission, "board_task": task, "eligible": True}

    @staticmethod
    def _link(board, mission):
        if mission.get("queue_board_link_error"):
            raise ValueError("The prepared mission has an unresolved board-link failure.")
        if (mission.get("status") != "ready" or mission.get("mode") not in ("local", "live")
                or mission.get("round", 0) != 0):
            raise ValueError("Only undispatched ready local or API missions are eligible.")
        links = [task for task in board["tasks"] if task.get("missionId") == mission["id"]]
        if len(links) != 1 or links[0]["status"] != "ready":
            raise ValueError("The mission needs exactly one explicit ready canonical board link.")
        task = links[0]
        if task.get("assignment") != mission.get("prompt"):
            raise ValueError("The board assignment differs from the ready mission.")
        if task.get("runtimeSpecSha256", _spec(mission)) != _spec(mission):
            raise ValueError("The prepared mission specification changed.")
        return task

    def _readiness(self, mission, cache=None):
        cache = {} if cache is None else cache
        if "manifest" not in cache:
            cache["manifest"] = self.engine.studio.manifest() if self.engine.studio else {}
        manifest = cache["manifest"]
        if manifest.get("is_current") is not True:
            raise ValueError("The Studio snapshot is stale or unavailable.")
        if mission.get("requires_tests") and not manifest.get("capabilities", {}).get("run_pytest"):
            raise ValueError("This mission requires unavailable isolated tests.")
        if "budget" not in cache:
            cache["budget"] = self.store.budget()
        budget = cache["budget"]
        if mission["mode"] == "local":
            if "local" not in cache:
                cache["local"] = self.engine.providers.local.status()
            if not cache["local"].get("configured"):
                raise ValueError("The local model is unavailable; no paid fallback is allowed.")
        else:
            if "providers" not in cache:
                cache["providers"] = self.engine.providers.public_status()
            providers = cache["providers"]
            if not all(providers.get(name, {}).get("configured") for name in ("openai", "gemini")):
                raise ValueError("Both existing API providers must be connected.")
            if (budget.get("uncertain") or budget.get("expired")
                    or min(budget.get("remaining_today_usd", 0), budget.get("remaining_pilot_usd", 0)) <= 0):
                raise ValueError("API dispatch is blocked by the existing budget or billing guard.")

    def inventory(self):
        with self.engine.lock, self.lock, self.store.lock:
            error = None
            try:
                board, _ = self._board()
            except ValueError as exc:
                board, error = {"tasks": []}, str(exc)
            if error is None:
                try:
                    self._company()
                except ValueError as exc:
                    error = str(exc)
            counts = {state: sum(t["status"] == state for t in board["tasks"]) for state in sorted(STATES)}
            blocked = [{"id": t["id"], "title": t.get("title", ""),
                        "reason": t.get("validationStatus") or t.get("assignment") or "Evidence or access is blocked."}
                       for t in board["tasks"] if t["status"] == "blocked"]
            missions = []
            readiness_cache = {}
            review_ids = self._unreviewed()
            review_reason = "External review is outstanding before queue dispatch." if review_ids else None
            for mission in self.store.summaries():
                if mission.get("status") != "ready":
                    continue
                reason = error or review_reason
                task = None
                if reason is None:
                    try:
                        task = self._link(board, mission)
                        if self.store.snapshot(mission["id"]).get("calls"):
                            raise ValueError("A mission with prior calls cannot enter the queue.")
                        self._readiness(mission, readiness_cache)
                    except ValueError as exc:
                        reason = str(exc)
                missions.append({"id": mission["id"], "title": mission["title"], "mode": mission["mode"],
                                 "eligible": reason is None, "reason": reason,
                                 "board_task_id": task["id"] if task else None})
            return {"board": {"counts": counts, "blocked": blocked,
                              "ready_count": counts["ready"], "error": error},
                    "missions": missions, "reasons": [reason for reason in (error, review_reason) if reason]}

    @staticmethod
    def _user_messages(data):
        return [{key: message.get(key) for key in ("id", "sender", "recipient", "kind", "text")}
                for message in data.get("messages", []) if message.get("sender") == "user"]

    def _unreviewed(self):
        return [mission["id"] for mission in self.store.summaries()
                if review_flags(mission)["requires_review"]]

    @staticmethod
    def _review(mission):
        resolution = mission.get("review_resolution") or {}
        if resolution.get("disposition") == "evidence_blocked":
            return "blocked"
        if (resolution.get("disposition") in ("reviewed", "rejected", "superseded")
                and resolution.get("reviewer") in ("codex", "user")):
            return "reviewed"
        review = mission.get("coordinator_review") or {}
        if review.get("reviewer") in ("codex", "user") and type(review.get("accepted")) is bool:
            return "reviewed"
        return "pending"

    def start(self, ids, mode="local", duration_minutes=20, cadence_minutes=1, paid_confirmed=False):
        if (not isinstance(ids, (list, tuple)) or not 1 <= len(ids) <= 3
                or any(not isinstance(i, str) or not re.fullmatch(r"m_[0-9a-f]{16}", i) for i in ids)
                or len(ids) != len(set(ids))):
            raise ValueError("Select one to three distinct explicit ready mission IDs.")
        if mode not in ("local", "live") or type(paid_confirmed) is not bool:
            raise ValueError("Choose local or explicitly confirmed API queue mode.")
        if mode == "live" and paid_confirmed is not True:
            raise ValueError("Starting an API queue requires explicit paid confirmation.")
        if any(type(value) is not int or not 1 <= value <= 60 for value in (duration_minutes, cadence_minutes)):
            raise ValueError("Queue duration and cadence must be integers from one to sixty minutes.")
        with self.engine.lock, self.lock, self.store.lock:
            if self._session["enabled"] or (self._thread and self._thread.is_alive()):
                raise ValueError("A bounded queue session is already active or stopping.")
            board, raw = self._board()
            company_hash = self._company()
            frozen = {}
            for identity in ids:
                data = self.store.snapshot(identity)
                mission = data["mission"]
                if mission["mode"] != mode or data.get("calls"):
                    raise ValueError("Every selected mission must be undispatched and match the queue mode.")
                task = self._link(board, mission)
                self._readiness(mission)
                frozen[identity] = {"mission_spec_sha256": _spec(mission),
                                    "user_messages": self._user_messages(data),
                                    "board_task": copy.deepcopy(task), "board_sha256": _hash(raw)}
            instant = datetime.now(timezone.utc)
            self._wall_deadline = instant + timedelta(minutes=duration_minutes)
            self._mono_deadline = time.monotonic() + duration_minutes * 60
            self._next_dispatch = time.monotonic()
            self._last_owned = None
            self._frozen = frozen
            self._wake = threading.Event()
            self._session = {"enabled": True, "running": True, "state": "running", "id": uid("queue_session"),
                             "mode": mode, "mission_ids": list(ids), "pending_ids": list(ids),
                             "owned_active_id": None, "last_error": None, "started_at": instant.isoformat(),
                             "expires_at": self._wall_deadline.isoformat(), "cadence_minutes": cadence_minutes,
                             "duration_minutes": duration_minutes}
            self.store.event("queue_session_started", session_id=self._session["id"], mode=mode,
                             mission_ids=list(ids), duration_minutes=duration_minutes,
                             cadence_minutes=cadence_minutes, expires_at=self._session["expires_at"],
                             observed_company_sha256=company_hash)
            self._start_thread(self._session["id"])
            return self.status()

    def _start_thread(self, identity):
        self._thread = threading.Thread(target=self._run, args=(identity,), daemon=True, name="sigil-bounded-queue")
        self._thread.start()

    def _remaining(self):
        return min(self._mono_deadline - time.monotonic(),
                   (self._wall_deadline - datetime.now(timezone.utc)).total_seconds())

    def _finish(self, state, error=None, *, stop_owned=False):
        was_enabled = self._session["enabled"]
        self._session.update(enabled=False, running=False, state=state, last_error=error)
        if stop_owned and self._last_owned and self.engine.active_id == self._last_owned:
            self.engine.stop(self._last_owned)
        self._session["owned_active_id"] = (self._last_owned if self.engine.active_id == self._last_owned else None)
        if was_enabled:
            self.store.event("queue_session_finished", session_id=self._session["id"], state=state,
                             owned_mission_id=self._last_owned, remaining_ids=list(self._session["pending_ids"]))
        self._wake.set()

    def _tick(self):
        with self.engine.lock, self.lock, self.store.lock:
            if not self._session["enabled"]:
                return
            if self._remaining() <= 0:
                self._finish("expired", "The finite queue session expired.", stop_owned=True)
                return
            active = self.engine.active_id
            self._session["owned_active_id"] = self._last_owned if active == self._last_owned else None
            if active:
                self._session["state"] = "running" if active == self._last_owned else "waiting_active"
                return
            if self._last_owned:
                review = self._review(self.store.snapshot(self._last_owned)["mission"])
                if review == "blocked":
                    self._finish("blocked", "The previous owned mission has an evidence-blocked review.")
                    return
                if review != "reviewed":
                    self._session["state"] = "waiting_review"
                    return
            if self._unreviewed():
                self._session["state"] = "waiting_review"
                return
            if not self._session["pending_ids"]:
                self._finish("completed")
                return
            if time.monotonic() < self._next_dispatch:
                self._session["state"] = "waiting_cadence"
                return
            identity = self._session["pending_ids"][0]
            try:
                company_hash = self._company()
                board, _ = self._board()
                data = self.store.snapshot(identity)
                mission = data["mission"]
                task = self._link(board, mission)
                frozen = self._frozen[identity]
                if (data.get("calls") or _spec(mission) != frozen["mission_spec_sha256"]
                        or self._user_messages(data) != frozen["user_messages"]
                        or task != frozen["board_task"]):
                    raise ValueError("The selected mission or its ready board specification changed.")
                self._readiness(mission)
                remaining = self._remaining()
                if remaining <= 0:
                    self._finish("expired", "The finite queue session expired.", stop_owned=True)
                    return
                # Engine applies this bound before creating its worker thread.
                self._last_owned = identity
                self.engine.start(identity, max_runtime_seconds=min(remaining, MAX_MISSION_SECONDS))
                self.store.event("queue_mission_dispatched", session_id=self._session["id"],
                                 mission_id=identity, board_task_id=task["id"],
                                 observed_board_sha256=frozen["board_sha256"],
                                 observed_company_sha256=company_hash)
                self._session["pending_ids"].pop(0)
                self._session["owned_active_id"] = identity if self.engine.active_id == identity else None
                self._session["last_mission_id"] = identity
                self._session["state"] = "running"
                self._next_dispatch = time.monotonic() + self._session["cadence_minutes"] * 60
            except (ValueError, KeyError) as exc:
                self._finish("blocked", str(exc) if isinstance(exc, ValueError) else "A selected mission no longer exists.", stop_owned=True)

    def _run(self, identity):
        try:
            while True:
                with self.lock:
                    if self._session["id"] != identity or not self._session["enabled"]:
                        return
                self._tick()
                if self._wake.wait(1):
                    return
        except Exception:
            with self.engine.lock, self.lock, self.store.lock:
                self._finish("blocked", "The queue stopped after an internal controller error.", stop_owned=True)

    def status(self):
        with self.lock:
            return copy.deepcopy(self._session)

    def stop(self):
        with self.engine.lock, self.lock, self.store.lock:
            self._finish("stopped", stop_owned=True)
            return self.status()

    def shutdown(self):
        self.stop()
        thread = self._thread
        if thread and thread is not threading.current_thread():
            thread.join(timeout=3)
        return not (thread and thread.is_alive())
