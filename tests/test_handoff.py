from datetime import datetime, timedelta, timezone

import pytest

from swarm.handoff import Decision, Progress, add_record, answer_record, digest
from swarm.store import Store


def test_decision_survives_restart_and_cannot_dispatch_or_overwrite(tmp_path):
    store = Store(tmp_path)
    identity = store.store_id
    before = store.budget()
    item = add_record(store, 'decisions', Decision(question='Choose a layout?',
        recommendation='Dense overview', blocks='Visual polish', can_continue='Data audit', options=['Dense', 'Spacious']))
    answer_record(store, item['id'], 'Dense')
    with pytest.raises(ValueError): answer_record(store, item['id'], 'Overwrite')
    assert store.summaries() == [] and store.ledger == []
    assert store.budget() == before
    store.close()
    store = Store(tmp_path)
    try:
        result = digest(store)
        assert result['decisions'][0]['answer'] == 'Dense'
        assert store.store_id == identity
        assert store.summaries() == []
    finally: store.close()


def test_digest_window_and_uncertain_cost_are_explicit(tmp_path):
    store = Store(tmp_path)
    try:
        at = datetime.now(timezone.utc)
        add_record(store, 'progress', Progress(title='Reviewed change', summary='Evidence checked'))
        store.ledger = [dict(created_at=at.isoformat(), status='completed', cost_usd=0.025),
            dict(created_at=at.isoformat(), status='uncertain', cost_usd=None),
            dict(created_at=(at-timedelta(days=2)).isoformat(), status='completed', cost_usd=50)]
        result = digest(store, at=at+timedelta(seconds=1))
        assert result['recorded_estimate_usd'] == 0.025
        assert result['unresolved_calls'] == 1
        assert len(result['progress']) == 1
        assert digest(store, at=at+timedelta(days=2))['progress'] == []
    finally: store.close()


def test_blank_and_missing_answers_do_not_change_state(tmp_path):
    store = Store(tmp_path)
    try:
        with pytest.raises(ValueError): answer_record(store, 'missing', 'yes')
        with pytest.raises(ValueError): answer_record(store, 'missing', '   ')
        assert digest(store)['decisions'] == []
    finally: store.close()
