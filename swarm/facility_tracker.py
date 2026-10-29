"""Manual evidence tracker. Timing comparison is not a financial surprise model.

No HTTP, prices, model calls, schedules or orders. Use a separate research DB.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
from pathlib import Path
import sqlite3
from urllib.parse import parse_qsl, urlparse
from .event_ledger import EventLedger, text, timestamp

HOSTS = {'www.cfindustries.com', 'ir.cfindustries.com',
         'investors.cvrpartners.com', 'investors.lsbindustries.com',
         'www.prnewswire.com', 'www.businesswire.com', 'www.sec.gov',
         'www.globenewswire.com', 'financialmodelingprep.com', 'finance.yahoo.com'}


def public_url(value):
    text(value)
    u = urlparse(value)
    if (u.scheme != 'https' or u.hostname not in HOSTS or u.username or u.password
            or u.port or u.fragment or any(k.lower() in {'apikey', 'api_key', 'token', 'key', 'authorization'}
                                          for k, _ in parse_qsl(u.query))):
        raise ValueError('Public allowlisted HTTPS reference without credentials required')
    return value


def interval(start, end):
    a, b = timestamp(start), timestamp(end)
    if b < a:
        raise ValueError('Reversed interval')
    return a, b


def timing_relation(expected_start, expected_end, actual_start, actual_end):
    a, b = interval(expected_start, expected_end)
    c, d = interval(actual_start, actual_end)
    return ('earlier' if d < a else 'later' if c > b else
            'within_announced_window' if c >= a and d <= b else 'overlap_indeterminate')


class FacilityTracker:
    def __init__(self, path, clock=None):
        target = Path(path)
        if target.exists():
            with sqlite3.connect(target.resolve().as_uri()+'?mode=ro',uri=True) as existing:
                if not existing.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='facility_tracker_schema'").fetchone():
                    raise ValueError('Existing database is not a facility tracker; preserve it')
                if existing.execute('SELECT version FROM facility_tracker_schema').fetchall() != [(2,)]:
                    raise ValueError('Unsupported facility tracker schema')
        self.ledger = EventLedger(path)
        self.ledger.db.execute('CREATE TABLE IF NOT EXISTS facility_tracker_schema (version INTEGER PRIMARY KEY)')
        self.ledger.db.execute('INSERT OR IGNORE INTO facility_tracker_schema VALUES (2)')
        self.ledger.db.executescript('''
            CREATE TABLE IF NOT EXISTS facility_source_bytes (
                source_id TEXT PRIMARY KEY REFERENCES records(id), content BLOB NOT NULL);
            CREATE TRIGGER IF NOT EXISTS immutable_source_update BEFORE UPDATE ON facility_source_bytes
                BEGIN SELECT RAISE(ABORT, 'immutable source bytes'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_source_delete BEFORE DELETE ON facility_source_bytes
                BEGIN SELECT RAISE(ABORT, 'immutable source bytes'); END;
        ''')
        self.ledger.db.commit()
        self.clock = clock or (lambda: datetime.now(timezone.utc).isoformat())

    def close(self):
        self.ledger.close()

    def _now(self):
        return timestamp(self.clock()).isoformat()

    @contextmanager
    def _write(self):
        self.ledger.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.ledger.db.commit()
        except Exception:
            self.ledger.db.rollback()
            raise

    def source(self, *, url, content, published_at, representation='original_bytes'):
        public_url(url)
        if not isinstance(content, bytes) or not 1 <= len(content) <= 2_000_000:
            raise ValueError('Bounded nonempty bytes required')
        if representation not in ('original_bytes', 'rendered_primary_note'):
            raise ValueError('Unknown source representation')
        now = self._now()
        if published_at is not None and timestamp(published_at) > timestamp(now):
            raise ValueError('Publication after receipt')
        with self._write():
            ident = self.ledger._put('facility_source', dict(url=url, published_at=published_at,
                received_at=now, representation=representation,
                retained_content_sha256=hashlib.sha256(content).hexdigest(),
                original_bytes_sha256=hashlib.sha256(content).hexdigest() if representation == 'original_bytes' else None,
                bytes=len(content)))
            self.ledger.db.execute('INSERT OR IGNORE INTO facility_source_bytes VALUES (?,?)',(ident,content))
            return ident

    def source_bytes(self, ident):
        source = self.ledger.get(ident, 'facility_source')
        row = self.ledger.db.execute('SELECT content FROM facility_source_bytes WHERE source_id=?',(ident,)).fetchone()
        if row is None or len(row[0]) != source['bytes'] or hashlib.sha256(row[0]).hexdigest() != source['retained_content_sha256']:
            raise ValueError('Retained source bytes missing or changed')
        return row[0]

    def _source(self, ident, mode, now):
        source = self.ledger.get(ident, 'facility_source')
        self.source_bytes(ident)
        if timestamp(source['received_at']) > timestamp(now):
            raise ValueError('Clock precedes source receipt')
        if mode == 'prospective' and (source['published_at'] is None or source['representation'] != 'original_bytes'):
            raise ValueError('Prospective record requires original bytes and explicit publication evidence')
        return source

    def _head(self, episode):
        rows = self.ledger.db.execute("SELECT id FROM records WHERE kind='facility_expectation' ORDER BY rowid").fetchall()
        matches = [ident for (ident,) in rows if self.ledger.get(ident, 'facility_expectation')['episode'] == episode]
        return matches[-1] if matches else None

    def _confirmed(self, episode):
        rows = self.ledger.db.execute("SELECT id FROM records WHERE kind='facility_confirmation'").fetchall()
        return any(self.ledger.get(ident, 'facility_confirmation')['episode'] == episode for (ident,) in rows)

    def expectation(self, *, episode, issuer, facility, unit, source_id,
                    target_start, target_end, mode='prospective', prior_id=None):
        if mode not in ('prospective', 'retrospective_audit') or issuer not in ('CF', 'UAN', 'LXU'):
            raise ValueError('Explicit supported issuer and mode required')
        for value in (episode, facility, unit):
            text(value)
        start, end = interval(target_start, target_end)
        now = self._now()
        with self._write():
            if self._confirmed(episode):
                raise ValueError('Episode already confirmed; use a new episode for a new disruption')
            source = self._source(source_id, mode, now)
            if mode == 'prospective' and start <= timestamp(now):
                raise ValueError('Expected window already begun: use retrospective audit')
            if self._head(episode) != prior_id:
                raise ValueError('Missing baseline or stale prior expectation')
            change = 'baseline'
            if prior_id:
                prior = self.ledger.get(prior_id, 'facility_expectation')
                if any(prior[k] != v for k, v in [('issuer',issuer),('facility',facility),('unit',unit),('mode',mode)]):
                    raise ValueError('Revision changes episode identity or mode')
                if timestamp(prior['recorded_at']) > timestamp(now):
                    raise ValueError('Clock precedes prior record')
                if mode == 'prospective':
                    old = self._source(prior['source_id'], mode, now)
                    if timestamp(source['published_at']) <= timestamp(old['published_at']):
                        raise ValueError('Source is not a newer publication')
                relation = timing_relation(prior['target_start'], prior['target_end'], target_start, target_end)
                change = 'guidance_repeated' if (start,end) == interval(prior['target_start'],prior['target_end']) else 'guidance_'+relation
            return self.ledger._put('facility_expectation', dict(episode=episode,issuer=issuer,
                facility=facility,unit=unit,source_id=source_id,target_start=target_start,
                target_end=target_end,mode=mode,prior_id=prior_id,recorded_at=now,
                change=change,financial_surprise='not_inferred'))

    def confirmation(self, *, expectation_id, source_id, actual_start, actual_end):
        a,b = interval(actual_start, actual_end)
        now = self._now()
        with self._write():
            prior = self.ledger.get(expectation_id, 'facility_expectation')
            if self._confirmed(prior['episode']):
                raise ValueError('Episode already confirmed; preserve original evidence')
            if self._head(prior['episode']) != expectation_id:
                raise ValueError('Confirmation must reference latest guidance')
            source = self._source(source_id, prior['mode'], now)
            if b > timestamp(source['received_at']) or timestamp(prior['recorded_at']) > timestamp(now):
                raise ValueError('Actual outcome or prior record lies in the future')
            if source['published_at'] is not None and a > timestamp(source['published_at']):
                raise ValueError('Source predates claimed actual operation')
            if prior['mode'] == 'prospective':
                old = self._source(prior['source_id'], prior['mode'], now)
                if a <= timestamp(prior['recorded_at']) or timestamp(source['published_at']) <= timestamp(old['published_at']):
                    raise ValueError('Late baseline or old confirmation source')
            old_source = self._source(prior['source_id'], prior['mode'], now)
            before_operation = (timestamp(old_source['published_at']) < a) if old_source['published_at'] else None
            relation = (timing_relation(prior['target_start'],prior['target_end'],actual_start,actual_end)
                        if before_operation is True else 'unavailable_prior_guidance_time'
                        if before_operation is None else 'invalid_hindsight_guidance')
            return self.ledger._put('facility_confirmation', dict(episode=prior['episode'],expectation_id=expectation_id,
                source_id=source_id,actual_start=actual_start,actual_end=actual_end,
                recorded_at=now,mode=prior['mode'],
                timing_relation=relation,
                guidance_published_before_operation=before_operation,
                financial_surprise='not_inferred',first_public_confirmation_verified=False))

    def price_reference(self, *, confirmation_id, url, symbol, start_at, end_at):
        public_url(url)
        parsed = urlparse(url)
        query = parse_qsl(parsed.query)
        if parsed.hostname == 'finance.yahoo.com':
            if parsed.path != f'/quote/{symbol}/history/':
                raise ValueError('Price reference symbol mismatch')
        elif parsed.hostname == 'financialmodelingprep.com':
            if parsed.path != '/stable/historical-price-eod/dividend-adjusted' or [v for k,v in query if k=='symbol'] != [symbol]:
                raise ValueError('Price reference endpoint or symbol mismatch')
        else:
            raise ValueError('Declared public price-history reference required')
        start,end = interval(start_at,end_at)
        now = self._now()
        with self._write():
            confirmation = self.ledger.get(confirmation_id, 'facility_confirmation')
            if timestamp(now) < timestamp(confirmation['recorded_at']):
                raise ValueError('Clock precedes confirmation record')
            prior = self.ledger.get(confirmation['expectation_id'], 'facility_expectation')
            if symbol not in (prior['issuer'],'SPY','XLB'):
                raise ValueError('Issuer or declared benchmark reference required')
            source = self.ledger.get(confirmation['source_id'], 'facility_source')
            anchor = source['received_at'] if prior['mode']=='prospective' else source['published_at']
            if anchor is None or start < timestamp(anchor)+timedelta(minutes=60) or end > timestamp(now):
                raise ValueError('Price window lacks valid information lag or ends in future')
            return self.ledger._put('facility_price_reference', dict(confirmation_id=confirmation_id,
                url=url,symbol=symbol,start_at=start_at,end_at=end_at,recorded_at=now,
                status='reference_only_not_fetched',returns=None,mode=prior['mode'],
                meaning='No computed reaction, attribution, execution or profit implied'))
