"""Offline, caller-selected trial journal; never dispatches or authenticates evidence.

The existing experiment registry owns experiment identity. This companion retains
immutable variants and terminal outcomes; it is not a queue or spending guard.
Store only bounded non-sensitive metadata, never source bodies or credentials.
"""
import hashlib
import json
import math
import sqlite3
from datetime import datetime, timezone


TERMINAL = {'negative', 'positive_exploratory', 'inconclusive', 'failed', 'rejected', 'blocked', 'abandoned'}


def canonical(value):
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if len(encoded.encode()) > 65536:
        raise ValueError('metadata_too_large')
    return encoded


def text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 2000:
        raise ValueError('invalid_text')
    return value


def digest(value):
    if not isinstance(value, str) or len(value) != 64 or any(c not in '0123456789abcdef' for c in value):
        raise ValueError('invalid_sha256')


class TrialLedger:
    def __init__(self, path):
        # No default path: callers must explicitly select an offline database.
        self.db = sqlite3.connect(path, timeout=5)
        self.db.execute('PRAGMA foreign_keys=ON')
        schema = '''
        CREATE TABLE IF NOT EXISTS trials (
          trial_id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL, recorded_at TEXT NOT NULL,
          protocol TEXT NOT NULL, UNIQUE(experiment_id,fingerprint));
        CREATE TABLE IF NOT EXISTS outcomes (
          trial_id TEXT PRIMARY KEY REFERENCES trials(trial_id),
          recorded_at TEXT NOT NULL, payload TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS trials_no_update BEFORE UPDATE ON trials
          BEGIN SELECT RAISE(ABORT,'immutable_trial'); END;
        CREATE TRIGGER IF NOT EXISTS trials_no_delete BEFORE DELETE ON trials
          BEGIN SELECT RAISE(ABORT,'immutable_trial'); END;
        CREATE TRIGGER IF NOT EXISTS outcomes_no_update BEFORE UPDATE ON outcomes
          BEGIN SELECT RAISE(ABORT,'immutable_outcome'); END;
        CREATE TRIGGER IF NOT EXISTS outcomes_no_delete BEFORE DELETE ON outcomes
          BEGIN SELECT RAISE(ABORT,'immutable_outcome'); END;
        CREATE TRIGGER IF NOT EXISTS trials_no_replace BEFORE INSERT ON trials
          WHEN EXISTS(SELECT 1 FROM trials WHERE trial_id=NEW.trial_id
            OR (experiment_id=NEW.experiment_id AND fingerprint=NEW.fingerprint))
          BEGIN SELECT RAISE(ABORT,'immutable_trial'); END;
        CREATE TRIGGER IF NOT EXISTS outcomes_no_replace BEFORE INSERT ON outcomes
          WHEN EXISTS(SELECT 1 FROM outcomes WHERE trial_id=NEW.trial_id)
          BEGIN SELECT RAISE(ABORT,'immutable_outcome'); END;
        '''
        def definitions(db):
            return {name:sql for name,sql in db.execute(
                "SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")}
        expected = sqlite3.connect(':memory:')
        try:
            expected.executescript(schema)
            if not definitions(self.db):
                self.db.executescript(schema)
            if definitions(self.db) != definitions(expected):
                raise ValueError('incompatible_trial_ledger_schema')
        except Exception:
            self.db.close()
            raise
        finally:
            expected.close()

    def close(self):
        self.db.close()

    def register(self, trial_id, experiment_id, protocol, registered_experiments):
        text(trial_id); text(experiment_id)
        if experiment_id not in registered_experiments:
            raise ValueError('experiment_not_registered')
        if not isinstance(protocol, dict):
            raise ValueError('protocol_required')
        for field in ('hypothesis', 'baseline', 'split', 'metric', 'cost_assumptions', 'variant'):
            text(protocol.get(field))
        digest(protocol.get('code_sha256'))
        sources = protocol.get('data')
        if not isinstance(sources, list) or not sources:
            raise ValueError('data_provenance_required')
        for source in sources:
            text(source['id']); digest(source['sha256']); text(source['availability_basis'])
        if len({s['id'] for s in sources}) != len(sources):
            raise ValueError('duplicate_source_id')
        payload = canonical(protocol)
        # Variant names are labels, not independent evidence. Identical protocols
        # renamed as another variant remain duplicates within the experiment.
        identity = {k:v for k,v in protocol.items() if k != 'variant'}
        fingerprint = hashlib.sha256(canonical(identity).encode()).hexdigest()
        with self.db:
            prior = self.db.execute('SELECT experiment_id,protocol FROM trials WHERE trial_id=?', (trial_id,)).fetchone()
            if prior:
                if prior == (experiment_id, payload):
                    return False
                raise ValueError('trial_identity_conflict')
            try:
                self.db.execute('INSERT INTO trials VALUES (?,?,?,?,?)',
                                (trial_id, experiment_id, fingerprint, datetime.now(timezone.utc).isoformat(), payload))
            except sqlite3.IntegrityError:
                raise ValueError('duplicate_trial_or_protocol') from None
        return True

    def finish(self, trial_id, status, summary, artifact_sha256, estimated_api_usd=None):
        text(trial_id); text(summary); digest(artifact_sha256)
        if status not in TERMINAL:
            raise ValueError('invalid_terminal_status')
        if estimated_api_usd is not None and (type(estimated_api_usd) not in (int,float)
                or not math.isfinite(estimated_api_usd) or estimated_api_usd < 0):
            raise ValueError('invalid_cost')
        payload = canonical(dict(status=status, summary=summary, artifact_sha256=artifact_sha256,
                                 estimated_api_usd=estimated_api_usd, provider_billing='unknown'))
        with self.db:
            self.db.execute('INSERT INTO outcomes VALUES (?,?,?)',
                            (trial_id, datetime.now(timezone.utc).isoformat(), payload))

    def records(self):
        return [dict(trial_id=t, experiment_id=e, protocol_fingerprint=h,
                     protocol_sha256=hashlib.sha256(p.encode()).hexdigest(), recorded_at=at,
                     protocol=json.loads(p), status=json.loads(o)['status'] if o else 'registered',
                     outcome_recorded_at=when, outcome=json.loads(o) if o else None)
                for t,e,h,at,p,when,o in self.db.execute('''
                  SELECT t.*,o.recorded_at,o.payload FROM trials t
                  LEFT JOIN outcomes o USING(trial_id) ORDER BY t.recorded_at,t.trial_id''')]

    def registered_trials(self):
        return {row[0] for row in self.db.execute('SELECT trial_id FROM trials')}
