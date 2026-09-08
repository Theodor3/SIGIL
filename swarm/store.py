import copy
import hashlib
import json
import os
import re
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .models import DAILY_LIMIT, MAX_ROUNDS, MAX_SPECIALISTS, PILOT_LIMIT


SCHEMA_VERSION = 1


def now():
    return datetime.now(timezone.utc).isoformat()


def local_day():
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex[:16]


class BudgetError(ValueError):
    pass


class Store:
    """Single-controller SQLite store for missions, events and the spend ledger."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._process_lock = (self.root / "controller.lock").open("a+b")
        self._process_lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                if self._process_lock.read(1) == b"":
                    self._process_lock.write(b"0")
                    self._process_lock.flush()
                self._process_lock.seek(0)
                msvcrt.locking(self._process_lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._process_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._process_lock.close()
            raise RuntimeError("Another SIGIL controller is already using this workspace.") from None

        self.lock = threading.RLock()
        self.db_path = self.root / "swarm.sqlite3"
        self._db = None
        try:
            self._db = sqlite3.connect(self.db_path, timeout=5, check_same_thread=False)
            self._db.row_factory = sqlite3.Row
            self._db.execute("PRAGMA foreign_keys = ON")
            self._db.execute("PRAGMA busy_timeout = 5000")
            self._db.execute("PRAGMA journal_mode = WAL")
            self._db.execute("PRAGMA synchronous = FULL")
            self._prepare_schema()
            self._migrate_legacy_json()
            self.store_id = self._meta("store_id")
            if not self.store_id:
                self.store_id = uid("store")
                self._set_meta("store_id", self.store_id)
            self.missions = self._load_missions()
            self.ledger = self._load_calls()
            self.settings = self._load_settings()
            self._recover_interrupted_work()
        except Exception:
            if self._db is not None:
                self._db.close()
            self._process_lock.close()
            raise

    @property
    def schema_version(self):
        return SCHEMA_VERSION

    def runtime_identity(self):
        return {
            "store_id": self.store_id,
            "schema_version": self.schema_version,
            "database": str(self.db_path),
            "journal_mode": self._db.execute("PRAGMA journal_mode").fetchone()[0].lower(),
        }

    def _prepare_schema(self):
        current = int(self._db.execute("PRAGMA user_version").fetchone()[0])
        if current > SCHEMA_VERSION:
            raise RuntimeError(
                f"This dashboard cannot open storage schema {current}; it supports {SCHEMA_VERSION}."
            )
        with self._db:
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS missions (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    data_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS calls (
                    id TEXT PRIMARY KEY,
                    mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE RESTRICT,
                    task_id TEXT,
                    agent_id TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    status TEXT NOT NULL,
                    day TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    finished_at TEXT,
                    reservation_usd REAL NOT NULL CHECK (reservation_usd >= 0),
                    cost_usd REAL NOT NULL CHECK (cost_usd >= 0),
                    data_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS calls_mission_idx ON calls(mission_id, created_at);
                CREATE INDEX IF NOT EXISTS calls_budget_idx ON calls(day, provider, status);
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    mission_id TEXT REFERENCES missions(id) ON DELETE RESTRICT,
                    at TEXT NOT NULL,
                    type TEXT NOT NULL,
                    data_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS events_mission_idx ON events(mission_id, at);
                """
            )
            if current < SCHEMA_VERSION:
                self._db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _meta(self, key, default=None):
        row = self._db.execute("SELECT value FROM metadata WHERE key = ?", (key,)).fetchone()
        return row[0] if row else default

    def _set_meta(self, key, value):
        with self._db:
            self._db.execute(
                "INSERT INTO metadata(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    @staticmethod
    def _json(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    def _legacy_paths(self):
        paths = []
        for name in ("pilot.json", "budget.json", "messages.jsonl"):
            path = self.root / name
            if path.is_file():
                paths.append(path)
        paths.extend(path for path in sorted(self.root.glob("m_*.json")) if path.is_file())
        return paths

    def _migrate_legacy_json(self):
        if self._meta("legacy_migration_completed_at"):
            return
        if self._db.execute("SELECT COUNT(*) FROM missions").fetchone()[0] or self._db.execute(
            "SELECT COUNT(*) FROM calls"
        ).fetchone()[0]:
            self._set_meta("legacy_migration_completed_at", now())
            return

        paths = self._legacy_paths()
        if not paths:
            self._set_meta("legacy_migration_completed_at", now())
            return

        # Parse every source before changing the database, then retain a checksummed backup.
        pilot_path = self.root / "pilot.json"
        budget_path = self.root / "budget.json"
        settings = json.loads(pilot_path.read_text(encoding="utf-8")) if pilot_path.exists() else None
        ledger = json.loads(budget_path.read_text(encoding="utf-8")) if budget_path.exists() else []
        missions = []
        for path in sorted(self.root.glob("m_*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            mission_id = data.get("mission", {}).get("id")
            if not re.fullmatch(r"m_[0-9a-f]{16}", mission_id or ""):
                raise RuntimeError(f"Legacy mission file has an invalid identity: {path.name}")
            missions.append(data)

        event_rows = []
        events_path = self.root / "messages.jsonl"
        if events_path.exists():
            for line_number, line in enumerate(events_path.read_text(encoding="utf-8").splitlines(), 1):
                if line.strip():
                    try:
                        event_rows.append(json.loads(line))
                    except json.JSONDecodeError as exc:
                        raise RuntimeError(
                            f"Legacy event history is invalid at messages.jsonl line {line_number}."
                        ) from exc

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = self.root / f"legacy-json-backup-{stamp}"
        suffix = 1
        while backup.exists():
            backup = self.root / f"legacy-json-backup-{stamp}-{suffix}"
            suffix += 1
        backup.mkdir()
        manifest = {"created_at": now(), "files": []}
        for path in paths:
            target = backup / path.name
            shutil.copy2(path, target)
            content = target.read_bytes()
            manifest["files"].append(
                {"name": path.name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
            )
        (backup / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )

        known_missions = {data["mission"]["id"] for data in missions}
        with self._db:
            if settings is not None:
                self._db.execute(
                    "INSERT INTO metadata(key, value) VALUES('pilot_settings', ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (self._json(settings),),
                )
            for data in missions:
                self._upsert_mission(data, touch=False)
            for call in ledger:
                if call.get("mission_id") not in known_missions:
                    raise RuntimeError("Legacy spend ledger refers to a missing mission.")
                self._upsert_call(call)
            for event in event_rows:
                mission_id = event.get("mission_id")
                if mission_id and mission_id not in known_missions:
                    continue
                self._insert_event(event)
            self._db.execute(
                "INSERT INTO metadata(key, value) VALUES('legacy_backup', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (backup.name,),
            )
            self._db.execute(
                "INSERT INTO metadata(key, value) VALUES('legacy_migration_completed_at', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (now(),),
            )

    def _load_missions(self):
        result = {}
        for row in self._db.execute("SELECT data_json FROM missions ORDER BY created_at"):
            data = json.loads(row[0])
            result[data["mission"]["id"]] = data
        return result

    def _load_calls(self):
        return [json.loads(row[0]) for row in self._db.execute("SELECT data_json FROM calls ORDER BY created_at, id")]

    def _load_settings(self):
        raw = self._meta("pilot_settings")
        if raw:
            settings = json.loads(raw)
        else:
            settings = {
                "started_on": local_day(),
                "expires_on": (
                    datetime.fromisoformat(local_day()).date() + timedelta(days=7)
                ).isoformat(),
                "daily_limit_usd": DAILY_LIMIT,
                "pilot_limit_usd": PILOT_LIMIT,
            }
        # A mutable data file can narrow the compiled authorization, never expand it.
        settings["daily_limit_usd"] = min(
            DAILY_LIMIT, max(0, float(settings.get("daily_limit_usd", DAILY_LIMIT)))
        )
        settings["pilot_limit_usd"] = min(
            PILOT_LIMIT, max(0, float(settings.get("pilot_limit_usd", PILOT_LIMIT)))
        )
        with self._db:
            self._db.execute(
                "INSERT INTO metadata(key, value) VALUES('pilot_settings', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (self._json(settings),),
            )
        return settings

    def _recover_interrupted_work(self):
        changed_calls = []
        for item in self.ledger:
            if item["status"] == "reserved":
                item["status"] = "uncertain"
                item["finished_at"] = now()
                item["error"] = "The controller restarted before this reservation was settled."
                changed_calls.append(item)
        changed_missions = []
        for data in self.missions.values():
            if data["mission"]["status"] in ("running", "stopping"):
                data["mission"]["status"] = "blocked"
                data["mission"]["summary"] = (
                    "The server restarted during this mission. Review its last call before starting a new mission."
                )
                data["mission"]["interrupted_at"] = now()
                data["mission"]["replay_allowed"] = False
                for task in data["tasks"]:
                    if task["status"] in ("running", "queued"):
                        task["status"] = "interrupted"
                changed_missions.append(data)
        if changed_calls or changed_missions:
            with self._db:
                for call in changed_calls:
                    self._upsert_call(call)
                for data in changed_missions:
                    self._upsert_mission(data)

    def _upsert_mission(self, data, *, touch=True):
        mission = data["mission"]
        if touch:
            mission["updated_at"] = now()
        self._db.execute(
            """INSERT INTO missions(id, status, mode, created_at, updated_at, data_json)
               VALUES(?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 status=excluded.status, mode=excluded.mode,
                 created_at=excluded.created_at, updated_at=excluded.updated_at,
                 data_json=excluded.data_json""",
            (
                mission["id"], mission["status"], mission["mode"],
                mission["created_at"], mission["updated_at"], self._json(data),
            ),
        )

    def _upsert_call(self, call):
        self._db.execute(
            """INSERT INTO calls(
                 id, mission_id, task_id, agent_id, provider, model, status, day,
                 created_at, finished_at, reservation_usd, cost_usd, data_json
               ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 task_id=excluded.task_id, agent_id=excluded.agent_id,
                 provider=excluded.provider, model=excluded.model,
                 status=excluded.status, day=excluded.day,
                 created_at=excluded.created_at, finished_at=excluded.finished_at,
                 reservation_usd=excluded.reservation_usd, cost_usd=excluded.cost_usd,
                 data_json=excluded.data_json""",
            (
                call["id"], call["mission_id"], call.get("task_id"), call["agent_id"],
                call["provider"], call["model"], call["status"], call["day"],
                call["created_at"], call.get("finished_at"), call["reservation_usd"],
                call.get("cost_usd", 0), self._json(call),
            ),
        )

    def _insert_event(self, event):
        event = dict(event)
        event.setdefault("id", uid("evt"))
        event.setdefault("at", now())
        event.setdefault("type", "event")
        self._db.execute(
            "INSERT OR IGNORE INTO events(id, mission_id, at, type, data_json) VALUES(?, ?, ?, ?, ?)",
            (event["id"], event.get("mission_id"), event["at"], event["type"], self._json(event)),
        )
        return event

    def close(self):
        try:
            if self._db is not None:
                self._db.close()
                self._db = None
        finally:
            if not self._process_lock.closed:
                self._process_lock.close()

    # Compatibility helpers retained for bounded maintenance and migration tests.
    def read(self, name, default):
        path = self.root / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

    def write(self, name, value):
        path = self.root / name
        temp = path.with_suffix(path.suffix + ".tmp")
        with temp.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)

    def event(self, event_type, **fields):
        with self.lock, self._db:
            return self._insert_event({"id": uid("evt"), "at": now(), "type": event_type, **fields})

    def save(self, data):
        with self.lock, self._db:
            self._upsert_mission(data)

    def get(self, mission_id):
        if not re.fullmatch(r"m_[0-9a-f]{16}", mission_id) or mission_id not in self.missions:
            raise KeyError("Mission not found")
        return self.missions[mission_id]

    def snapshot(self, mission_id):
        with self.lock:
            data = copy.deepcopy(self.get(mission_id))
            data["calls"] = copy.deepcopy([x for x in self.ledger if x["mission_id"] == mission_id])
            data["mission"]["spent_usd"] = round(sum(x.get("cost_usd", 0) for x in data["calls"]), 6)
            data["mission"]["cost_kind"] = "estimate"
            data.setdefault("tool_results", [])
            data.setdefault("drafts", [])
            return data

    def summaries(self):
        with self.lock:
            return [self.snapshot(key)["mission"] for key in sorted(
                self.missions,
                key=lambda key: self.missions[key]["mission"]["created_at"],
                reverse=True,
            )]

    def create(self, prompt, mode, *, max_revisions=MAX_ROUNDS - 1,
               specialist_execution="parallel"):
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("Write a mission for the team first.")
        with self.lock:
            if len(self.missions) >= 200:
                raise ValueError("The pilot has reached its 200-mission storage limit.")
            mission_id = uid("m")
            timestamp = now()
            data = {
                "mission": dict(
                    id=mission_id, title=prompt.splitlines()[0][:80],
                    prompt=prompt, mode=mode, status="ready", created_at=timestamp,
                    updated_at=timestamp, round=0,
                    max_revisions=max_revisions, max_rounds=1 + max_revisions,
                    specialist_execution=specialist_execution,
                    max_specialists=MAX_SPECIALISTS, spent_usd=0, summary="", peer_rounds=0,
                    replay_allowed=True,
                ),
                "messages": [], "tasks": [], "artifacts": [], "calls": [],
                "pending_assignments": [], "sources": [],
                "tool_results": [], "drafts": [], "studio": None,
            }
            self.missions[mission_id] = data
            message = dict(
                id=uid("msg"), sender="user", recipient="coordinator", text=prompt,
                kind="mission", created_at=now(), round=0, mode=mode, handled=False,
            )
            data["messages"].append(message)
            with self._db:
                self._upsert_mission(data)
                self._insert_event(
                    {"id": uid("evt"), "at": now(), "type": "message", "mission_id": mission_id, "message": message}
                )
            return copy.deepcopy(data["mission"])

    def message(self, mission_id, sender, recipient, text, kind="finding", *, handled=False):
        with self.lock:
            data = self.get(mission_id)
            if len(data["messages"]) >= 500:
                raise ValueError("This mission reached its message limit. Start a new mission.")
            msg = dict(
                id=uid("msg"), sender=sender, recipient=recipient, text=text,
                kind=kind, created_at=now(), round=data["mission"]["round"],
                mode=data["mission"]["mode"], handled=handled,
            )
            data["messages"].append(msg)
            with self._db:
                self._insert_event(
                    {"id": uid("evt"), "at": now(), "type": "message", "mission_id": mission_id, "message": msg}
                )
                self._upsert_mission(data)
            return copy.deepcopy(msg)

    @staticmethod
    def _validate_source_linked_claims(data, claims):
        if type(claims) is not list or not claims or len(claims) > 12:
            raise ValueError("Source-linked Studio claims must be a nonempty bounded list.")

        studio = data.get("studio")
        if not isinstance(studio, dict):
            raise ValueError("Source-linked artifacts require a pinned Studio snapshot.")
        expected_commit = studio.get("commit")
        available_paths = studio.get("files")
        if (
            not isinstance(expected_commit, str)
            or re.fullmatch(r"[0-9a-f]{40,64}", expected_commit) is None
        ):
            raise ValueError("Source-linked artifacts require a pinned Studio commit.")
        if type(available_paths) is not list or not all(isinstance(path, str) for path in available_paths):
            raise ValueError("Source-linked artifacts require a valid Studio file manifest.")
        available_paths = set(available_paths)

        records = {
            record.get("id"): record
            for record in data.get("tool_results", [])
            if isinstance(record, dict) and isinstance(record.get("id"), str)
        }
        claim_keys = {"field", "status", "observation", "consequence", "evidence"}
        evidence_keys = {
            "tool_result_id", "task_id", "agent_id", "path", "start", "end",
            "total_lines", "line_truncated", "text_truncated", "complete_file",
            "sha256", "commit",
        }
        for claim in claims:
            if type(claim) is not dict or set(claim) != claim_keys:
                raise ValueError("A source-linked Studio claim is not fully materialized.")
            if claim["status"] not in ("present", "absent", "unproven"):
                raise ValueError("A source-linked Studio claim has an invalid status.")
            for key in ("field", "observation", "consequence"):
                if not isinstance(claim[key], str) or not claim[key].strip():
                    raise ValueError("A source-linked Studio claim has an empty required field.")
            evidence_items = claim["evidence"]
            if type(evidence_items) is not list or not evidence_items or len(evidence_items) > 9:
                raise ValueError("Every source-linked Studio claim requires recorded evidence.")

            seen_ids = set()
            coverage_by_path = {}
            for evidence in evidence_items:
                if type(evidence) is not dict or set(evidence) != evidence_keys:
                    raise ValueError("Source-linked Studio evidence is not fully materialized.")
                record_id = evidence["tool_result_id"]
                if not isinstance(record_id, str) or not record_id or record_id in seen_ids:
                    raise ValueError("Source-linked Studio evidence has an invalid record ID.")
                seen_ids.add(record_id)
                record = records.get(record_id)
                if (
                    record is None
                    or record.get("tool") != "read_file"
                    or record.get("status") != "completed"
                    or not isinstance(record.get("result"), dict)
                ):
                    raise ValueError("Source-linked Studio evidence does not match a completed read.")

                raw = record["result"]
                path = raw.get("path")
                start, end, total_lines = raw.get("start"), raw.get("end"), raw.get("total_lines")
                line_truncated = raw.get("line_truncated")
                text_truncated = raw.get("text_truncated")
                complete_file = raw.get("complete_file")
                sha256, commit = raw.get("sha256"), raw.get("commit")
                if (
                    not isinstance(path, str)
                    or not path
                    or path not in available_paths
                    or type(start) is not int
                    or type(end) is not int
                    or type(total_lines) is not int
                    or not (1 <= start <= end <= total_lines)
                    or not isinstance(raw.get("text"), str)
                    or not raw["text"]
                    or type(line_truncated) is not bool
                    or type(text_truncated) is not bool
                    or type(complete_file) is not bool
                    or complete_file != (
                        start == 1 and end == total_lines
                        and not line_truncated and not text_truncated
                    )
                    or not isinstance(sha256, str)
                    or re.fullmatch(r"[0-9a-f]{64}", sha256) is None
                    or commit != expected_commit
                ):
                    raise ValueError("A recorded Studio read has invalid pinned provenance.")
                expected = {
                    "tool_result_id": record_id,
                    "task_id": record.get("task_id"),
                    "agent_id": record.get("agent_id"),
                    "path": path,
                    "start": start,
                    "end": end,
                    "total_lines": total_lines,
                    "line_truncated": line_truncated,
                    "text_truncated": text_truncated,
                    "complete_file": complete_file,
                    "sha256": sha256,
                    "commit": commit,
                }
                if evidence != expected:
                    raise ValueError("Source-linked Studio evidence differs from its recorded read.")
                coverage_by_path.setdefault(path, []).append(expected)

            if claim["status"] in ("absent", "unproven"):
                for path_evidence in coverage_by_path.values():
                    if any(item["text_truncated"] for item in path_evidence):
                        raise ValueError("Absence claims require untruncated Studio text.")
                    totals = {item["total_lines"] for item in path_evidence}
                    hashes = {item["sha256"] for item in path_evidence}
                    if len(totals) != 1 or len(hashes) != 1:
                        raise ValueError("Absence claims require one consistent pinned file version.")
                    total_lines = next(iter(totals))
                    covered_through = 0
                    for item in sorted(path_evidence, key=lambda value: (value["start"], value["end"])):
                        if item["start"] > covered_through + 1:
                            raise ValueError("Absence claims require continuous full-file coverage.")
                        covered_through = max(covered_through, item["end"])
                    if covered_through != total_lines:
                        raise ValueError("Absence claims require continuous full-file coverage.")

    def artifact(self, mission_id, author, title, body, sources=None, *,
                 provenance_status="none", studio_claims=None):
        with self.lock:
            data = self.get(mission_id)
            materialized_claims = copy.deepcopy([] if studio_claims is None else studio_claims)
            if provenance_status not in ("none", "invalid", "source_linked"):
                raise ValueError("Unknown artifact provenance status.")
            if provenance_status == "source_linked":
                self._validate_source_linked_claims(data, materialized_claims)
            elif materialized_claims:
                raise ValueError("Only source-linked artifacts may contain Studio claims.")
            artifact = dict(
                id=uid("art"), title=title, body=body, author=author,
                created_at=now(), verification="sample" if data["mission"]["mode"] == "demo" else "unverified",
                sources=sources or [], provenance_status=provenance_status,
                studio_claims=materialized_claims,
                round=data["mission"]["round"],
            )
            data["artifacts"].append(artifact)
            with self._db:
                self._insert_event(
                    {"id": uid("evt"), "at": now(), "type": "artifact", "mission_id": mission_id,
                     "artifact_id": artifact["id"], "author": author}
                )
                self._upsert_mission(data)
            return copy.deepcopy(artifact)

    def budget(self):
        with self.lock:
            day = local_day()
            daily_limit = self.settings["daily_limit_usd"]
            pilot_limit = self.settings["pilot_limit_usd"]
            today = sum(x.get("cost_usd", 0) for x in self.ledger if x["day"] == day)
            total = sum(x.get("cost_usd", 0) for x in self.ledger)
            held = sum(x["reservation_usd"] for x in self.ledger if x["status"] in ("reserved", "uncertain"))
            return dict(
                daily_limit_usd=daily_limit, pilot_limit_usd=pilot_limit,
                today_usd=round(today, 6), pilot_usd=round(total, 6),
                reserved_usd=round(held, 6),
                remaining_today_usd=round(max(0, daily_limit - today - held), 6),
                remaining_pilot_usd=round(max(0, pilot_limit - total - held), 6),
                expires_on=self.settings["expires_on"], timezone="America/New_York",
                expired=day >= self.settings["expires_on"],
                uncertain=any(x["status"] == "uncertain" for x in self.ledger),
                cost_kind="estimate",
                by_provider={provider: {
                    "today_usd": round(sum(
                        x.get("cost_usd", 0) for x in self.ledger if x["provider"] == provider and x["day"] == day
                    ), 6),
                    "pilot_usd": round(sum(
                        x.get("cost_usd", 0) for x in self.ledger if x["provider"] == provider
                    ), 6),
                } for provider in ("gemini", "openai")},
            )

    def reserve(self, mission_id, agent_id, provider, model, amount, *, task_id=None):
        with self.lock:
            self.get(mission_id)
            budget = self.budget()
            if budget["expired"]:
                raise BudgetError("The seven-day pilot has ended. Its budget needs renewal before another API mission.")
            if budget["uncertain"]:
                raise BudgetError("A previous API call has uncertain billing. Live work is paused until it is reconciled.")
            if amount <= 0 or amount > min(
                budget["remaining_today_usd"], budget["remaining_pilot_usd"]
            ) + 1e-9:
                raise BudgetError("The next call would exceed the remaining budget. Work has stopped before dispatch.")
            call = dict(
                id=uid("call"), mission_id=mission_id, agent_id=agent_id, provider=provider,
                task_id=task_id, model=model, status="reserved", created_at=now(), day=local_day(),
                reservation_usd=round(amount, 6), cost_usd=0,
            )
            with self._db:
                self._upsert_call(call)
            self.ledger.append(call)
            return call["id"]

    def settle(self, call_id, cost=None, usage=None, returned_model=None, response_id=None, error=None):
        with self.lock:
            call = next((item for item in self.ledger if item["id"] == call_id), None)
            if call is None:
                raise KeyError("Call not found")
            if call["status"] not in ("reserved", "uncertain"):
                raise ValueError("This call was already accounted for.")
            if cost is None:
                call["status"] = "uncertain"
            else:
                call["status"] = "failed" if error else "completed"
                call["cost_usd"] = round(max(0, cost), 6)
                if cost > call["reservation_usd"] + 0.000001:
                    call["status"] = "uncertain"
                    call["reservation_usd"] = 0
                    error = "Provider usage exceeded its reservation. Budget reconciliation is required."
            call.update(
                finished_at=now(), usage=usage, returned_model=returned_model,
                response_id=response_id, error=error,
            )
            with self._db:
                self._upsert_call(call)
