import sqlite3
import pytest
from swarm.event_ledger import EventLedger, timestamp


@pytest.fixture
def ledger(tmp_path):
    item = EventLedger(tmp_path / 'research.sqlite3')
    yield item
    item.close()


def receipt(ledger, received='2026-01-01T10:00:00Z'):
    return ledger.receipt(source='https://example.org/issued-report', sha256='a'*64,
        available_at='2026-01-01T09:00:00Z', received_at=received)


def forecast(ledger, **overrides):
    args = dict(event_id='heat-001', definition='Station exceeds 35C on target day',
        decision_at='2026-01-01T12:00:00Z', target_at='2026-01-02T23:59:00Z',
        probability=.7, receipts=[receipt(ledger)], model='fixed-baseline-v1')
    args.update(overrides)
    return ledger.forecast(**args)


def test_roundtrip_reopen_score(ledger):
    ident = forecast(ledger)
    with pytest.raises(ValueError, match='unresolved'):
        ledger.score(ident)
    evidence = receipt(ledger, '2026-01-03T10:00:00Z')
    ledger.resolve(ident, outcome=True, resolved_at='2026-01-03T11:00:00Z', receipt_id=evidence)
    count = ledger.db.execute('SELECT count(*) FROM records').fetchone()[0]
    assert ledger.score(ident)['brier'] == pytest.approx(.09)
    assert forecast(ledger) == ident
    with pytest.raises(ValueError, match='already resolved'):
        ledger.resolve(ident, outcome=True, resolved_at='2026-01-04T11:00:00Z', receipt_id=evidence)
    assert ledger.db.execute('SELECT count(*) FROM records').fetchone()[0] == count


@pytest.mark.parametrize('p', [True, float('nan'), float('inf'), -0.1, 1.1, '0.7'])
def test_bad_probability(ledger, p):
    with pytest.raises(ValueError):
        forecast(ledger, probability=p)


def test_leakage_and_missing_source(ledger):
    with pytest.raises(ValueError, match='not received'):
        forecast(ledger, receipts=[receipt(ledger, '2026-01-02T10:00:00Z')])
    with pytest.raises(ValueError, match='missing'):
        forecast(ledger, receipts=['b'*64])
    with pytest.raises(ValueError, match='future'):
        forecast(ledger, target_at='2026-01-01T12:00:00Z')


def test_time_validation(ledger):
    with pytest.raises(ValueError):
        timestamp('2026-01-01T12:00:00')
    assert timestamp('2026-01-01T07:00:00-05:00') == timestamp('2026-01-01T12:00:00Z')
    with pytest.raises(ValueError):
        receipt(ledger, '2025-12-31T10:00:00Z')


def test_immutable_records(ledger):
    ident = forecast(ledger)
    for statement in ('DELETE FROM records WHERE id=?', 'UPDATE records SET body=body WHERE id=?'):
        with pytest.raises(sqlite3.IntegrityError, match='immutable'):
            ledger.db.execute(statement, (ident,))
    with pytest.raises(sqlite3.IntegrityError, match='immutable'):
        ledger.db.execute("INSERT OR REPLACE INTO records VALUES (?, 'forecast', '{}')", (ident,))


def test_resolution_timing_and_type(ledger):
    ident = forecast(ledger)
    evidence = receipt(ledger, '2026-01-03T10:00:00Z')
    with pytest.raises(ValueError):
        ledger.resolve(ident, outcome=1, resolved_at='2026-01-04T00:00:00Z', receipt_id=evidence)
    with pytest.raises(ValueError, match='precedes'):
        ledger.resolve(ident, outcome=False, resolved_at='2026-01-02T00:00:00Z', receipt_id=evidence)


def test_event_identity_and_persistence(tmp_path):
    path = tmp_path / 'ledger.sqlite3'
    item = EventLedger(path)
    ident = forecast(item)
    item.close()
    item = EventLedger(path)
    assert item.get(ident, 'forecast')['probability'] == .7
    with pytest.raises(ValueError, match='identity'):
        forecast(item, definition='A different outcome')
    with pytest.raises(ValueError, match='identity'):
        forecast(item, target_at='2026-01-04T00:00:00Z')
    assert forecast(item, probability=.8) != ident
    item.close()


def test_hash_corruption_fails_closed(ledger):
    ident = forecast(ledger)
    ledger.db.execute('DROP TRIGGER immutable_update')
    ledger.db.execute('UPDATE records SET body=? WHERE id=?', ('{}', ident))
    with pytest.raises(ValueError, match='hash mismatch'):
        ledger.get(ident, 'forecast')


def test_forecast_revisions_share_event_truth(ledger):
    first = forecast(ledger)
    second = forecast(ledger, probability=.8)
    evidence = receipt(ledger, '2026-01-03T10:00:00Z')
    args = dict(resolved_at='2026-01-03T11:00:00Z', receipt_id=evidence)
    ledger.resolve(first, outcome=True, **args)
    with pytest.raises(ValueError, match='conflicting outcome'):
        ledger.resolve(second, outcome=False, **args)
    ledger.resolve(second, outcome=True, **args)
    assert ledger.score(second)['brier'] == pytest.approx(.04)
