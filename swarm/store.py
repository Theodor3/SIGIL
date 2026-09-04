import copy
import json
import os
import re
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from .models import DAILY_LIMIT, MAX_ROUNDS, PILOT_LIMIT


def now():
    return datetime.now(timezone.utc).isoformat()


def local_day():
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex[:16]


class BudgetError(ValueError):
    pass


class Store:
    """One controller owns all writes. Model text cannot mutate these records."""

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
        self.missions = {}
        self.ledger = self.read("budget.json", [])
        self.settings = self.read("pilot.json", None)
        if self.settings is None:
            self.settings = {
                "started_on": local_day(),
                "expires_on": (
                    datetime.fromisoformat(local_day()).date() + timedelta(days=7)
                ).isoformat(),
                "daily_limit_usd": DAILY_LIMIT,
                "pilot_limit_usd": PILOT_LIMIT,
            }
            self.write("pilot.json", self.settings)
        for path in sorted(self.root.glob("m_*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            self.missions[data["mission"]["id"]] = data
        # A restart never silently redispatches an uncertain, potentially billed call.
        for item in self.ledger:
            if item["status"] == "reserved":
                item["status"] = "uncertain"
        self.write("budget.json", self.ledger)
        for data in self.missions.values():
            if data["mission"]["status"] in ("running", "stopping"):
                data["mission"]["status"] = "blocked"
                data["mission"]["summary"] = "The server restarted during this mission. Review its last call before starting a new mission."
                for task in data["tasks"]:
                    if task["status"] in ("running", "queued"):
                        task["status"] = "interrupted"
                self.save(data)

    def close(self):
        if not self._process_lock.closed:
            self._process_lock.close()

    def read(self, name, default):
        p = self.root / name
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default

    def write(self, name, value):
        p = self.root / name
        temp = p.with_suffix(p.suffix + ".tmp")
        with temp.open("w", encoding="utf-8", newline="\n") as f:
            json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, p)

    def event(self, event_type, **fields):
        with (self.root / "messages.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"id": uid("evt"), "at": now(), "type": event_type, **fields}, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def save(self, data):
        data["mission"]["updated_at"] = now()
        self.write(data["mission"]["id"] + ".json", data)

    def get(self, mission_id):
        if not re.fullmatch(r"m_[0-9a-f]{16}", mission_id) or mission_id not in self.missions:
            raise KeyError("Mission not found")
        return self.missions[mission_id]

    def snapshot(self, mission_id):
        with self.lock:
            data = copy.deepcopy(self.get(mission_id))
            data["calls"] = copy.deepcopy([x for x in self.ledger if x["mission_id"] == mission_id])
            data["mission"]["spent_usd"] = round(sum(x.get("cost_usd", 0) for x in data["calls"]), 6)
            return data

    def summaries(self):
        with self.lock:
            return [self.snapshot(k)["mission"] for k in sorted(
                self.missions, key=lambda k: self.missions[k]["mission"]["created_at"], reverse=True
            )]

    def create(self, prompt, mode):
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
                    updated_at=timestamp, round=0, max_rounds=MAX_ROUNDS,
                    spent_usd=0, summary="", peer_rounds=0,
                ),
                "messages": [], "tasks": [], "artifacts": [], "calls": [],
                "pending_assignments": [], "sources": [],
            }
            self.missions[mission_id] = data
            self.message(mission_id, "user", "coordinator", prompt, "mission")
            self.save(data)
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
            self.event("message", mission_id=mission_id, message=msg)
            data["messages"].append(msg)
            self.save(data)
            return copy.deepcopy(msg)

    def artifact(self, mission_id, author, title, body, sources=None):
        with self.lock:
            data = self.get(mission_id)
            artifact = dict(
                id=uid("art"), title=title, body=body, author=author,
                created_at=now(), verification="sample" if data["mission"]["mode"] == "demo" else "unverified",
                sources=sources or [], round=data["mission"]["round"],
            )
            data["artifacts"].append(artifact)
            self.event("artifact", mission_id=mission_id, artifact_id=artifact["id"], author=author)
            self.save(data)
            return artifact

    def budget(self):
        with self.lock:
            day = local_day()
            today = sum(x.get("cost_usd", 0) for x in self.ledger if x["day"] == day)
            total = sum(x.get("cost_usd", 0) for x in self.ledger)
            held = sum(x["reservation_usd"] for x in self.ledger if x["status"] in ("reserved", "uncertain"))
            # Outstanding reservations count against every day's available balance.
            return dict(
                daily_limit_usd=DAILY_LIMIT, pilot_limit_usd=PILOT_LIMIT,
                today_usd=round(today, 6), pilot_usd=round(total, 6),
                reserved_usd=round(held, 6),
                remaining_today_usd=round(max(0, DAILY_LIMIT - today - held), 6),
                remaining_pilot_usd=round(max(0, PILOT_LIMIT - total - held), 6),
                expires_on=self.settings["expires_on"], timezone="America/New_York",
                expired=day >= self.settings["expires_on"],
                uncertain=any(x["status"] == "uncertain" for x in self.ledger),
            )

    def reserve(self, mission_id, agent_id, provider, model, amount):
        with self.lock:
            b = self.budget()
            if b["expired"]:
                raise BudgetError("The seven-day pilot has ended. Its budget needs renewal before another API mission.")
            if b["uncertain"]:
                raise BudgetError("A previous API call has uncertain billing. Live work is paused until it is reconciled.")
            if amount <= 0 or amount > min(b["remaining_today_usd"], b["remaining_pilot_usd"]) + 1e-9:
                raise BudgetError("The next call would exceed the remaining budget. Work has stopped before dispatch.")
            call = dict(
                id=uid("call"), mission_id=mission_id, agent_id=agent_id, provider=provider,
                model=model, status="reserved", created_at=now(), day=local_day(),
                reservation_usd=round(amount, 6), cost_usd=0,
            )
            self.ledger.append(call)
            self.write("budget.json", self.ledger)
            return call["id"]

    def settle(self, call_id, cost=None, usage=None, returned_model=None, response_id=None, error=None):
        with self.lock:
            call = next(x for x in self.ledger if x["id"] == call_id)
            if call["status"] not in ("reserved", "uncertain"):
                raise ValueError("This call was already accounted for.")
            if cost is None:
                call["status"] = "uncertain"
            else:
                call["status"] = "failed" if error else "completed"
                call["cost_usd"] = round(max(0, cost), 6)
                if cost > call["reservation_usd"] + 0.000001:
                    # Preserve all costs and stop further dispatch if an estimate was insufficient.
                    call["status"] = "uncertain"
                    call["reservation_usd"] = 0
                    error = "Provider usage exceeded its reservation. Budget reconciliation is required."
            call.update(finished_at=now(), usage=usage, returned_model=returned_model, response_id=response_id, error=error)
            self.write("budget.json", self.ledger)
