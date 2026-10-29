"""Local research receipts, immutable forecasts and descriptive probability scores.

No broker, network, model calls or canonical swarm-store access. Timestamps are
assertions supplied by the researcher, not proof of historical publication.
"""
import hashlib
import json
import math
import sqlite3
from datetime import datetime, timezone


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('timestamp must be an ISO string')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('invalid timestamp') from exc
    if parsed.tzinfo is None:
        raise ValueError('timezone required')
    return parsed.astimezone(timezone.utc)


def text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 4096:
        raise ValueError('nonempty text up to 4096 characters required')
    return value


class EventLedger:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA recursive_triggers=ON')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS records (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY, definition TEXT NOT NULL, target_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS event_truth (
                event_id TEXT PRIMARY KEY REFERENCES events(event_id), outcome INTEGER NOT NULL);
            CREATE TRIGGER IF NOT EXISTS immutable_truth_update BEFORE UPDATE ON event_truth
                BEGIN SELECT RAISE(ABORT, 'immutable truth'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_truth_delete BEFORE DELETE ON event_truth
                BEGIN SELECT RAISE(ABORT, 'immutable truth'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_event_update BEFORE UPDATE ON events
                BEGIN SELECT RAISE(ABORT, 'immutable event'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_event_delete BEFORE DELETE ON events
                BEGIN SELECT RAISE(ABORT, 'immutable event'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON records
                BEGIN SELECT RAISE(ABORT, 'immutable record'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON records
                BEGIN SELECT RAISE(ABORT, 'immutable record'); END;
            CREATE TABLE IF NOT EXISTS resolutions (
                forecast_id TEXT PRIMARY KEY REFERENCES records(id),
                outcome_id TEXT UNIQUE NOT NULL REFERENCES records(id));
            CREATE TRIGGER IF NOT EXISTS immutable_resolution_update BEFORE UPDATE ON resolutions
                BEGIN SELECT RAISE(ABORT, 'immutable resolution'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_resolution_delete BEFORE DELETE ON resolutions
                BEGIN SELECT RAISE(ABORT, 'immutable resolution'); END;
        ''')

    def close(self):
        self.db.close()

    def _put(self, kind, payload):
        body = json.dumps({'kind': kind, **payload}, sort_keys=True,
                          separators=(',', ':'), allow_nan=False)
        ident = hashlib.sha256(body.encode()).hexdigest()
        self.db.execute('INSERT OR IGNORE INTO records VALUES (?,?,?)', (ident, kind, body))
        return ident

    def get(self, ident, kind):
        row = self.db.execute('SELECT kind,body FROM records WHERE id=?', (ident,)).fetchone()
        if row is None or row[0] != kind:
            raise ValueError('missing reference or incorrect record kind')
        if hashlib.sha256(row[1].encode()).hexdigest() != ident:
            raise ValueError('record hash mismatch')
        record = json.loads(row[1])
        if record.get('kind') != kind:
            raise ValueError('record kind mismatch')
        return record

    def receipt(self, *, source, sha256, available_at, received_at):
        text(source)
        if not isinstance(sha256, str) or len(sha256) != 64 or any(c not in '0123456789abcdef' for c in sha256):
            raise ValueError('lowercase SHA256 required')
        if timestamp(available_at) > timestamp(received_at):
            raise ValueError('availability cannot follow receipt')
        with self.db:
            return self._put('receipt', dict(source=source, sha256=sha256,
                available_at=available_at, received_at=received_at))

    def forecast(self, *, event_id, definition, decision_at, target_at, probability, receipts, model):
        for value in (event_id, definition, model):
            text(value)
        decision = timestamp(decision_at)
        if timestamp(target_at) <= decision:
            raise ValueError('target must be strictly future')
        if type(probability) not in (int, float) or not math.isfinite(probability) or not 0 <= probability <= 1:
            raise ValueError('finite probability in [0,1] required')
        if not isinstance(receipts, list) or not 1 <= len(receipts) <= 64 or any(not isinstance(x, str) for x in receipts):
            raise ValueError('one to 64 receipt IDs required')
        with self.db:
            normalized_target = timestamp(target_at).isoformat()
            self.db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?)',
                            (event_id, definition, normalized_target))
            existing = self.db.execute('SELECT definition,target_at FROM events WHERE event_id=?', (event_id,)).fetchone()
            if existing != (definition, normalized_target):
                raise ValueError('event identity cannot change definition or target')
            for ident in receipts:
                receipt = self.get(ident, 'receipt')
                if max(timestamp(receipt['available_at']), timestamp(receipt['received_at'])) > decision:
                    raise ValueError('source not received and available at decision')
            return self._put('forecast', dict(event_id=event_id, definition=definition,
                decision_at=decision_at, target_at=target_at, probability=probability,
                receipts=sorted(set(receipts)), model=model))

    def resolve(self, forecast_id, *, outcome, resolved_at, receipt_id):
        if type(outcome) is not bool:
            raise ValueError('binary boolean outcome required')
        with self.db:
            forecast = self.get(forecast_id, 'forecast')
            receipt = self.get(receipt_id, 'receipt')
            if timestamp(resolved_at) < max(timestamp(forecast['target_at']), timestamp(receipt['received_at'])):
                raise ValueError('resolution precedes target or outcome receipt')
            self.db.execute('INSERT OR IGNORE INTO event_truth VALUES (?,?)', (forecast['event_id'], int(outcome)))
            truth = self.db.execute('SELECT outcome FROM event_truth WHERE event_id=?', (forecast['event_id'],)).fetchone()[0]
            if truth != int(outcome):
                raise ValueError('conflicting outcome for the same event')
            ident = self._put('outcome', dict(forecast_id=forecast_id, outcome=outcome,
                resolved_at=resolved_at, receipt_id=receipt_id))
            try:
                self.db.execute('INSERT INTO resolutions VALUES (?,?)', (forecast_id, ident))
            except sqlite3.IntegrityError as exc:
                raise ValueError('forecast already resolved') from exc
            return ident

    def score(self, forecast_id):
        forecast = self.get(forecast_id, 'forecast')
        row = self.db.execute('SELECT outcome_id FROM resolutions WHERE forecast_id=?', (forecast_id,)).fetchone()
        if row is None:
            raise ValueError('unresolved forecast cannot be scored')
        outcome = self.get(row[0], 'outcome')['outcome']
        return {'forecast_id': forecast_id, 'brier': (forecast['probability'] - int(outcome)) ** 2,
                'meaning': 'descriptive probability error; not trading profit or validated alpha'}
