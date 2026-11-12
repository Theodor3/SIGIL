import sqlite3
import pytest
from swarm.facility_tracker import FacilityTracker, public_url, timing_relation


@pytest.fixture
def lab(tmp_path):
    now=['2026-01-01T12:00:00Z']
    tracker=FacilityTracker(tmp_path/'facility.sqlite3',clock=lambda:now[0])
    yield tracker,now
    tracker.close()


def source(t, published='2026-01-01T11:00:00Z', representation='original_bytes'):
    return t.source(url='https://www.prnewswire.com/news-releases/fixture.html',content=b'synthetic test only',published_at=published,representation=representation)


def expectation(t, source_id, **changes):
    args=dict(episode='CF-ammonia-001',issuer='CF',facility='Donaldsonville',unit='ammonia',source_id=source_id,
        target_start='2026-01-05T00:00:00Z',target_end='2026-01-06T23:59:59Z')
    args.update(changes)
    return t.expectation(**args)


def test_revision_chain_confirmation_and_price_reference(lab):
    t,now=lab
    first=expectation(t,source(t))
    now[0]='2026-01-02T12:00:00Z'
    second=expectation(t,source(t,'2026-01-02T11:00:00Z'),prior_id=first,
        target_start='2026-01-07T00:00:00Z',target_end='2026-01-08T23:59:59Z')
    assert t.ledger.get(second,'facility_expectation')['change']=='guidance_later'
    assert t.ledger.get(first,'facility_expectation')['target_start']=='2026-01-05T00:00:00Z'
    now[0]='2026-01-09T12:00:00Z'
    proof=source(t,'2026-01-09T11:00:00Z')
    confirmed=t.confirmation(expectation_id=second,source_id=proof,actual_start='2026-01-07T00:00:00Z',actual_end='2026-01-07T23:59:59Z')
    event=t.ledger.get(confirmed,'facility_confirmation')
    assert event['timing_relation']=='within_announced_window'
    assert event['financial_surprise']=='not_inferred'
    now[0]='2026-01-10T12:00:00Z'
    reference=t.price_reference(confirmation_id=confirmed,url='https://finance.yahoo.com/quote/SPY/history/',symbol='SPY',start_at='2026-01-09T13:00:00Z',end_at='2026-01-09T21:00:00Z')
    assert t.ledger.get(reference,'facility_price_reference')['returns'] is None
    with pytest.raises(ValueError,match='symbol mismatch'):
        t.price_reference(confirmation_id=confirmed,url='https://finance.yahoo.com/quote/CF/history/',symbol='SPY',start_at='2026-01-09T13:00:00Z',end_at='2026-01-09T21:00:00Z')
    with pytest.raises(ValueError,match='information lag'):
        t.price_reference(confirmation_id=confirmed,url='https://finance.yahoo.com/quote/SPY/history/',symbol='SPY',start_at='2026-01-09T12:59:59Z',end_at='2026-01-09T21:00:00Z')
    with pytest.raises(ValueError,match='already confirmed'):
        t.confirmation(expectation_id=second,source_id=proof,actual_start='2026-01-08T00:00:00Z',actual_end='2026-01-08T23:59:59Z')


@pytest.mark.parametrize('actual,expected',[('2026-01-04','earlier'),('2026-01-05','within_announced_window'),('2026-01-07','later')])
def test_interval_timing_is_not_surprise(actual,expected):
    assert timing_relation('2026-01-05T00:00:00Z','2026-01-06T23:59:59Z',actual+'T00:00:00Z',actual+'T23:59:59Z')==expected
    assert timing_relation('2026-01-05T12:00:00Z','2026-01-06T12:00:00Z','2026-01-05T00:00:00Z','2026-01-05T23:59:59Z')=='overlap_indeterminate'


def test_old_or_rendered_inputs_cannot_be_prospective(lab):
    t,_=lab
    for args in (dict(representation='rendered_primary_note'),):
        with pytest.raises(ValueError,match='requires original'):
            expectation(t,source(t,**args))
    with pytest.raises(ValueError,match='already begun'):
        expectation(t,source(t),target_start='2013-08-03T00:00:00Z',target_end='2013-08-03T23:59:59Z')


def test_receipt_based_prospective_baseline_does_not_invent_publication(lab):
    t,now=lab
    source_id=source(t,published=None)
    ident=expectation(t,source_id,milestone='production_startup')
    assert t.ledger.get(source_id,'facility_source')['published_at'] is None
    now[0]='2026-01-07T12:00:00Z'
    confirmation=t.confirmation(expectation_id=ident,source_id=source(t,published=None),actual_start='2026-01-05T00:00:00Z',actual_end='2026-01-05T23:59:59Z')
    record=t.ledger.get(confirmation,'facility_confirmation')
    assert record['baseline_recorded_before_operation'] is True
    assert record['guidance_published_before_operation'] is None
    assert record['timing_relation']=='within_announced_window'


def test_later_receipt_with_unknown_publication_cannot_revise_guidance(lab):
    t,now=lab
    ident=expectation(t,source(t,published=None))
    now[0]='2026-01-02T12:00:00Z'
    with pytest.raises(ValueError,match='newer publication'):
        expectation(t,source(t,published=None),prior_id=ident)


@pytest.mark.parametrize('published_date,published',[('2030-01-01',None),('2025-01-01','2026-01-01T11:00:00Z')])
def test_clear_publication_date_contradictions_rejected(lab,published_date,published):
    t,_=lab
    with pytest.raises(ValueError):
        t.source(url='https://www.cfindustries.com/newsroom/example',content=b'test',published_at=published,published_date=published_date)


def test_stale_or_cross_identity_revision_rejected(lab):
    t,now=lab
    baseline=expectation(t,source(t))
    now[0]='2026-01-02T12:00:00Z'
    later=source(t,'2026-01-02T11:00:00Z')
    with pytest.raises(ValueError,match='stale prior'):
        expectation(t,later)
    with pytest.raises(ValueError,match='identity'):
        expectation(t,later,prior_id=baseline,issuer='LXU')
    with pytest.raises(ValueError,match='newer publication'):
        expectation(t,source(t),prior_id=baseline)


def test_audit_is_received_now_not_a_past_forecast(lab):
    t,_=lab
    note=source(t,published=None,representation='rendered_primary_note')
    baseline=expectation(t,note,mode='retrospective_audit',target_start='2013-08-03T00:00:00Z',target_end='2013-08-03T23:59:59Z')
    record=t.ledger.get(baseline,'facility_expectation')
    assert record['recorded_at'].startswith('2026-01-01')
    assert record['mode']=='retrospective_audit'
    assert t.ledger.get(note,'facility_source')['original_bytes_sha256'] is None


def test_immutable_history(lab):
    t,_=lab;ident=expectation(t,source(t))
    with pytest.raises(sqlite3.IntegrityError):
        t.ledger.db.execute('UPDATE records SET body=? WHERE id=?',('{}',ident))


@pytest.mark.parametrize('url',['https://finance.yahoo.com.evil.example/','https://user@finance.yahoo.com/','https://financialmodelingprep.com/x?apikey=SECRET','http://finance.yahoo.com/'])
def test_private_or_unapproved_links_rejected(url):
    with pytest.raises(ValueError):public_url(url)


def test_future_confirmation_is_rejected(lab):
    t,_=lab;baseline=expectation(t,source(t))
    with pytest.raises(ValueError,match='future'):
        t.confirmation(expectation_id=baseline,source_id=source(t),actual_start='2026-01-07T00:00:00Z',actual_end='2026-01-07T23:59:59Z')


def test_existing_nontracker_database_is_preserved(tmp_path):
    path=tmp_path/'canonical.sqlite3'
    db=sqlite3.connect(path);db.execute('CREATE TABLE missions (id TEXT)');db.commit();db.close()
    before=path.read_bytes()
    with pytest.raises(ValueError,match='not a facility tracker'):
        FacilityTracker(path)
    assert path.read_bytes()==before


def test_reopen_uses_saved_history(tmp_path):
    path=tmp_path/'tracker.sqlite3'
    clock=lambda:'2026-01-01T12:00:00Z'
    t=FacilityTracker(path,clock=clock)
    source_id=source(t);ident=expectation(t,source_id);t.close()
    t=FacilityTracker(path,clock=clock)
    assert t.ledger.get(ident,'facility_expectation')['issuer']=='CF'
    assert t.source_bytes(source_id)==b'synthetic test only'
    with pytest.raises(ValueError,match='stale prior'):
        expectation(t,source(t))
    t.close()


@pytest.mark.parametrize('published,classification',[(None,'unavailable_prior_guidance_time'),('2013-08-05T12:00:00Z','invalid_hindsight_guidance')])
def test_audit_cannot_misclassify_unknown_or_hindsight_guidance(lab,published,classification):
    t,_=lab
    prior_source=source(t,published=published,representation='rendered_primary_note')
    baseline=expectation(t,prior_source,mode='retrospective_audit',target_start='2013-08-03T00:00:00Z',target_end='2013-08-03T23:59:59Z')
    proof=source(t,published='2013-08-07T13:19:00Z',representation='rendered_primary_note')
    ident=t.confirmation(expectation_id=baseline,source_id=proof,actual_start='2013-08-03T00:00:00Z',actual_end='2013-08-03T23:59:59Z')
    assert t.ledger.get(ident,'facility_confirmation')['timing_relation']==classification


def test_source_bytes_immutable_and_hash_checked(lab):
    t,_=lab;ident=source(t)
    with pytest.raises(sqlite3.IntegrityError):
        t.ledger.db.execute('UPDATE facility_source_bytes SET content=? WHERE source_id=?',(b'changed',ident))
    t.ledger.db.rollback()
    t.ledger.db.execute('DROP TRIGGER immutable_source_update')
    t.ledger.db.execute('UPDATE facility_source_bytes SET content=? WHERE source_id=?',(b'changed',ident))
    with pytest.raises(ValueError,match='bytes missing or changed'):t.source_bytes(ident)
