"""Human decision queue and rolling digest in the canonical store metadata.

Answers are records, never commands or dispatch authority.
"""
import json
from datetime import datetime, timedelta, timezone

from pydantic import Field

from .models import StrictModel
from .store import now, uid


class Decision(StrictModel):
    question: str = Field(min_length=5, max_length=500)
    recommendation: str = Field(min_length=1, max_length=1500)
    blocks: str = Field(min_length=1, max_length=1000)
    can_continue: str = Field(min_length=1, max_length=1000)
    evidence: list[str] = Field(default_factory=list, max_length=8)
    options: list[str] = Field(default_factory=list, max_length=4)


class Answer(StrictModel):
    answer: str = Field(min_length=1, max_length=2000)


class Progress(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=2000)
    evidence: list[str] = Field(default_factory=list, max_length=8)


def _read(store):
    return json.loads(store._meta('human_handoff_v1', '{"decisions":[],"progress":[]}'))


def add_record(store, kind, record):
    if kind not in ('decisions', 'progress'):
        raise ValueError('Unknown handoff record type.')
    with store.lock:
        data = _read(store)
        if len(data[kind]) >= 200:
            raise ValueError('Handoff storage limit reached; archive deliberately before adding more.')
        item = record.model_dump()
        if any(len(value) > 2000 for value in item.get('evidence', []) + item.get('options', [])):
            raise ValueError('Keep evidence references and options short.')
        item.update(id=uid('decision' if kind == 'decisions' else 'progress'), created_at=now())
        if kind == 'decisions':
            item.update(status='open', answer=None, answered_at=None)
        data[kind].append(item)
        store._set_meta('human_handoff_v1', json.dumps(data))
        return item


def answer_record(store, identity, answer):
    if not answer.strip():
        raise ValueError('Write an answer before saving.')
    with store.lock:
        data = _read(store)
        item = next((d for d in data['decisions'] if d['id'] == identity), None)
        if item is None:
            raise ValueError('Decision not found.')
        if item['status'] != 'open':
            raise ValueError('This decision already has an answer.')
        item.update(status='answered', answer=answer.strip(), answered_at=now())
        store._set_meta('human_handoff_v1', json.dumps(data))
        return item


def digest(store, active_id=None, at=None):
    at = at or datetime.now(timezone.utc)
    cutoff = at - timedelta(hours=24)
    def recent(timestamp):
        try:
            parsed = datetime.fromisoformat(timestamp)
            return cutoff <= parsed <= at
        except (TypeError, ValueError):
            return False
    with store.lock:
        data = _read(store)
        missions = [{k: m.get(k) for k in ('id', 'title', 'status', 'summary', 'updated_at', 'mode')}
                    for m in store.summaries() if recent(m.get('updated_at'))]
        calls = [c for c in store.ledger if recent(c.get('finished_at') or c.get('created_at'))]
        return dict(generated_at=at.isoformat(), window_hours=24, active_mission_id=active_id,
                    decisions=list(reversed(data['decisions'])),
                    progress=[p for p in reversed(data['progress']) if recent(p['created_at'])],
                    missions=missions, recorded_estimate_usd=round(sum(c.get('cost_usd') or 0 for c in calls), 6),
                    unresolved_calls=sum(c.get('status') in ('reserved', 'uncertain') for c in calls),
                    note='Rolling 24 hours. Recorded model cost estimates, not invoices. Answers never start work automatically.')
