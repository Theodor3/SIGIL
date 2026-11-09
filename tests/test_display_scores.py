import asyncio
import copy
import json
import sys
from datetime import date, datetime, timezone, timedelta
from types import ModuleType, SimpleNamespace

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from api import cache
from api.db.models import Base, PipelineRun
from api.db.ensure_columns import ensure_columns
from api.model import scorer
from api.model.score_snapshot import build_score_snapshot, read_run_scores
from api.regime.models import RegimeSnapshot
from api.signals.base import SignalOutput


def packet(monkeypatch, run_id='one'):
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'a': .75, 'b': .25})
    outputs = {'a': [SignalOutput('AAA', .8, .8), SignalOutput('BBB', .5, .9)],
               'b': [SignalOutput('AAA', .2, .6), SignalOutput('BBB', .6, .9)]}
    ranked = scorer.score_universe(outputs, {}, SimpleNamespace(factor_tilts={'a': 1.1, 'b': .9}))
    result = build_score_snapshot(run_id, ranked, {'AAA': {'sector': 'Industrials', 'market_cap': 100}},
                                  datetime.now(timezone.utc).isoformat())
    return ranked, result


def test_roundtrip_preserves_exact_rank_scores_and_attribution(monkeypatch):
    ranked, snapshot = packet(monkeypatch)
    run = SimpleNamespace(id='one', score_snapshot=json.loads(json.dumps(snapshot)))
    rows, status = read_run_scores(run)
    assert status == 'saved'
    assert [(r['ticker'], r['final_score'], r['confidence'], r['eligible']) for r in rows] == [
        (s.ticker, s.final_score, s.confidence, s.eligible) for s in ranked]
    assert rows[0]['final_score'] == .74
    assert rows[0]['signal_scores'] == ranked[0].signal_scores
    rows[0]['final_score'] = 99
    assert read_run_scores(run)[0][0]['final_score'] == .74  # no mutation by readers


@pytest.mark.parametrize('mutation', ['run', 'version', 'nan', 'duplicate', 'rank', 'order', 'naive', 'missing_version', 'missing_method', 'missing_flags'])
def test_invalid_snapshot_is_not_recomputed(monkeypatch, mutation):
    _, data = packet(monkeypatch)
    if mutation == 'run': data['run_id'] = 'other'
    if mutation == 'version': data['schema_version'] = 2
    if mutation == 'nan': data['rows'][0]['final_score'] = float('nan')
    if mutation == 'duplicate': data['rows'][1]['ticker'] = 'AAA'
    if mutation == 'rank': data['rows'][0]['rank'] = 2
    if mutation == 'order': data['rows'][0]['final_score'] = -.5
    if mutation == 'missing_version': del data['schema_version']
    if mutation == 'missing_method': del data['scoring_method']
    if mutation == 'missing_flags': del data['rows'][0]['gate_flags']
    if mutation == 'naive': data['decision_at'] = '2026-11-09T12:00:00'
    assert read_run_scores(SimpleNamespace(id='one', score_snapshot=data)) == ([], 'invalid_snapshot')


def test_missing_and_empty_are_distinct():
    assert read_run_scores(None) == ([], 'no_run')
    assert read_run_scores(SimpleNamespace(id='old', score_snapshot=None)) == ([], 'legacy_unavailable')
    snapshot = build_score_snapshot('empty', [], {}, '2026-11-09T12:00:00Z')
    assert read_run_scores(SimpleNamespace(id='empty', score_snapshot=snapshot)) == ([], 'saved')


def test_additive_migration_leaves_legacy_null_and_is_idempotent():
    async def check():
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with engine.begin() as conn:
            await conn.execute(text('CREATE TABLE pipeline_runs (id VARCHAR(36) PRIMARY KEY)'))
            await conn.execute(text("INSERT INTO pipeline_runs (id) VALUES ('old')"))
            assert await ensure_columns(conn) == {'pipeline_runs': ['score_snapshot']}
            assert await ensure_columns(conn) == {}
            assert (await conn.execute(text('SELECT score_snapshot FROM pipeline_runs'))).scalar() is None
        await engine.dispose()
    asyncio.run(check())


def test_dashboard_research_and_history_use_same_saved_run(monkeypatch):
    _, snapshot = packet(monkeypatch)
    # Score consumers may inspect current weights for labels, but must not re-rank saved rows.
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'a': .01, 'b': .99})
    def module(name, **values):
        m = ModuleType(name); m.__dict__.update(values); monkeypatch.setitem(sys.modules, name, m)
    signal = SimpleNamespace(name='a', default_weight=.01, meta=lambda: {'name': 'a'})
    module('api.signals.registry', get_registry=lambda: {'a': signal})
    module('api.routes.pipeline', _pipeline_running=False)
    module('api.data.registry', get_sources=lambda: {})
    from api.routes.dashboard import get_dashboard_data
    from api.routes.research import top_ideas_detailed, ticker_drilldown
    async def check():
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            db.add(PipelineRun(id='one', started_at=now, finished_at=now, status='completed',
                regime_id='risk_on', regime_confidence=.7, universe_size=2, score_snapshot=snapshot))
            old_snapshot = copy.deepcopy(snapshot); old_snapshot['run_id'] = 'earlier'
            db.add(PipelineRun(id='earlier', started_at=now-timedelta(minutes=1), status='completed',
                regime_id='risk_off', score_snapshot=old_snapshot))
            db.add(PipelineRun(id='old', started_at=now-timedelta(minutes=2), status='completed'))
            await db.commit()
            cache.clear(); cache.set('company:AAA', {'name': 'Synthetic fixture'}, ttl=600)
            dashboard = await get_dashboard_data(db, view='overview')
            ideas = await top_ideas_detailed(db)
            ticker = await ticker_drilldown('aaa', db)
            assert dashboard['score_status'] == ideas['score_status'] == ticker['score_status'] == 'saved'
            assert dashboard['top_ideas'] == snapshot['rows']
            assert [r['final_score'] for r in ideas['ideas']] == [r['final_score'] for r in snapshot['rows']]
            assert ticker['final_score'] == .74 and ticker['confidence'] == .7
            assert all(r['contribution'] is None for r in ticker['signals'])
            assert {r['run_id'] for r in ticker['score_history']} == {'one', 'earlier', 'old'}
            assert len(ticker['score_history']) == 3
            assert ticker['score_history'][-1]['score'] is None
            assert ticker['score_history'][-1]['score_status'] == 'legacy_unavailable'  # same day, separate runs; no invented legacy score
            # A newer legacy run is unavailable, never silently replaced by the previous saved run.
            db.add(PipelineRun(id='new-legacy', started_at=now+timedelta(seconds=1), status='completed'))
            await db.commit(); cache.clear(); cache.set('company:AAA', {}, ttl=600)
            assert (await get_dashboard_data(db, view='overview'))['top_ideas'] == []
            assert (await top_ideas_detailed(db))['score_status'] == 'legacy_unavailable'
            assert (await ticker_drilldown('AAA', db))['final_score'] is None
        cache.clear(); await engine.dispose()
    asyncio.run(check())


@pytest.mark.parametrize("serialization_failure", [False, True])
def test_real_pipeline_persists_the_returned_scores_without_external_calls(monkeypatch, tmp_path, serialization_failure):
    from api.pipeline import runner
    if serialization_failure:
        from api.model import score_snapshot
        def fail(*args, **kwargs): raise RuntimeError('synthetic serialization failure')
        monkeypatch.setattr(score_snapshot, '_build_score_snapshot', fail)
    from api.research import context_store
    from api.data import registry as source_registry
    async def empty(*args, **kwargs): return {}
    class FakeFMP:
        async def fetch_screening_data(self, *args):
            return {'AAA': {'sector': 'Industrials', 'market_cap': 100}}
        fetch_price_targets = empty
        fetch_shares_float = empty
        fetch_analyst_estimates = empty
    monkeypatch.setattr(runner, 'FMPProvider', FakeFMP)
    monkeypatch.setattr(runner, 'YahooProvider', lambda **kwargs: object())
    async def universe(): return ['AAA']
    monkeypatch.setattr(runner, 'fetch_universe_tickers', universe)
    monkeypatch.setattr(runner, 'screen_universe', lambda fundamentals: ['AAA'])
    for name in vars(runner):
        if name.startswith('_fetch_'): monkeypatch.setattr(runner, name, empty)
    async def regime(*args): return RegimeSnapshot(date.today(), 'risk_on', .8, .7, factor_tilts={'a': 1.1})
    monkeypatch.setattr(runner, 'detect_regime', regime)
    async def compute(ctx): return [SignalOutput('AAA', .8, .9)]
    monkeypatch.setattr(runner, 'get_registry', lambda: {'a': SimpleNamespace(default_weight=1, version='1', compute=compute)})
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'a': 1})
    monkeypatch.setattr(context_store, 'snapshot_dir', lambda: tmp_path)
    monkeypatch.setattr(source_registry, 'update_source_status', lambda *args, **kwargs: None)
    async def check():
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as db:
            result = await runner.run_pipeline(db)
            run = (await db.execute(select(PipelineRun).where(PipelineRun.id == result['run_id']))).scalar_one()
            assert run.status == 'completed'
            rows, status = read_run_scores(run)
            assert result['top_ideas'][0]['final_score'] == .88
            if serialization_failure:
                assert rows == [] and status == 'serialization_unavailable'
            else:
                assert status == 'saved' and rows[0]['final_score'] == .88
        # Fresh session proves the JSON survived the transaction, not just an in-memory assignment.
        async with sessions() as db:
            run = (await db.execute(select(PipelineRun))).scalar_one()
            if serialization_failure:
                assert read_run_scores(run) == ([], 'serialization_unavailable')
            else:
                assert read_run_scores(run)[0][0]['final_score'] == .88
        await engine.dispose(); cache.clear()
    asyncio.run(check())

@pytest.mark.parametrize('case', ['disabled', 'empty', 'threshold', 'multiple', 'tilt'])
def test_display_capture_never_changes_scores_or_targets(monkeypatch, case):
    from dataclasses import asdict
    from api.model.portfolio import construct_portfolio
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'a': 1.0, 'disabled': 0.0})
    outputs = {'a': [SignalOutput('AAA', .8, .8), SignalOutput('BBB', .5, .58)],
               'disabled': [SignalOutput('AAA', .9, .1)]}
    if case == 'disabled': outputs = {'disabled': [SignalOutput('AAA', .9, .9)]}
    if case == 'empty': outputs = {'a': [SignalOutput('AAA', 0, 0)]}
    if case == 'threshold': outputs = {'a': [SignalOutput('AAA', .8, .58), SignalOutput('BBB', .8, .5799)]}
    regime = SimpleNamespace(factor_tilts={'a': 2.0 if case == 'tilt' else 1.0})
    scored = scorer.score_universe(outputs, {}, regime)
    original = copy.deepcopy(scored)
    prices = {s.ticker: 100 for s in scored}
    sectors = {s.ticker: 'Unknown' for s in scored}
    targets = construct_portfolio(scored, 10000, prices, sectors)
    data = build_score_snapshot('fixture', scored, {}, '2026-11-09T12:00:00Z')
    rows, status = read_run_scores(SimpleNamespace(id='fixture', score_snapshot=data))
    assert status == 'saved'
    assert scored == original
    assert construct_portfolio(scored, 10000, prices, sectors) == targets
    assert scorer.score_universe(outputs, {}, regime) == original
    for row, actual in zip(rows, original):
        assert {key: row[key] for key in asdict(actual)} == asdict(actual)
    if case == 'empty': assert rows[0]['confidence'] == .6 and rows[0]['eligible']
    if case == 'disabled': assert rows[0]['signal_scores'] == {'disabled': .9} and rows[0]['confidence'] == .9
    if case == 'threshold': assert [s.eligible for s in original] == [True, False]
    if case == 'tilt': assert rows[0]['final_score'] > 1


def test_bad_output_is_unavailable_without_mutation(monkeypatch):
    ranked, _ = packet(monkeypatch)
    ranked[0].final_score = float('inf')
    original = copy.deepcopy(ranked)
    data = build_score_snapshot('one', ranked, {}, '2026-11-09T12:00:00Z')
    assert ranked == original
    assert read_run_scores(SimpleNamespace(id='one', score_snapshot=data)) == ([], 'serialization_unavailable')
