import asyncio
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from api.research import backtester as bt


DAY = date(2026, 9, 21)


def series(start=100, end=110, days=(0, 5)):
    return ([DAY + timedelta(days=d) for d in days], [start, end])


@pytest.fixture
def replay(monkeypatch):
    class Clock(date):
        @classmethod
        def today(cls):
            return date(2026, 10, 1)

    monkeypatch.setattr(bt, 'date', Clock)
    monkeypatch.setattr(bt, 'list_snapshot_dates', lambda: [DAY])
    monkeypatch.setattr(bt, 'load_context', lambda _: object())

    def run(history, scores=(('ABC', .8),), **kwargs):
        async def compute(_):
            return [SimpleNamespace(ticker=t, score=s, confidence=1) for t, s in scores]
        monkeypatch.setattr(bt, 'get_registry', lambda: {'test': SimpleNamespace(version='1', compute=compute)})
        monkeypatch.setattr(bt, '_download_history_sync', lambda *args: history)
        return asyncio.run(bt.backtest_signal('test', horizons=(5,), **kwargs))
    return run


def test_matched_long_short_cost_and_consistent_denominators(replay):
    result = replay({'ABC': series(), 'SPY': series(end=104)},
                    scores=(('ABC', .8), ('ABC', .2)), round_trip_cost_bps=25)
    r = result['horizons']['5d']
    assert r['n'] == r['alpha_n'] == r['eligible_calls'] == 2
    assert r['hit_rate'] == .5
    assert r['long_hit_rate'] == 1 and r['short_hit_rate'] == 0
    assert r['avg_alpha'] == 0
    assert r['estimated_net_alpha'] == -.0025
    assert result['methodology']['horizon_unit'] == 'calendar_days'


@pytest.mark.parametrize('benchmark', [None, ([], []), ([DAY], [100]), series(days=(-1, 4)), series(start=0), series(end=float('nan'))])
def test_unmatched_benchmark_never_falls_back_to_raw_return(replay, benchmark):
    history = {'ABC': series()}
    if benchmark is not None:
        history['SPY'] = benchmark
    r = replay(history)['horizons']['5d']
    assert r['n'] == r['alpha_n'] == 0
    assert r['skipped_benchmark_window'] == r['eligible_calls'] == 1
    assert r['avg_alpha'] is r['hit_rate'] is r['estimated_net_alpha'] is None


def test_missing_stock_and_missing_benchmark_are_counted_separately(replay):
    r = replay({'ABC': series(), 'BAD': series(days=(1, 5)), 'SPY': series(end=104)},
               scores=(('ABC', .8), ('MISSING', .8), ('BAD', .8)))['horizons']['5d']
    assert r['eligible_calls'] == 3
    assert r['n'] == 1 and r['skipped_stock_window'] == r['skipped_benchmark_window'] == 1
    assert r['avg_alpha'] == .06 and r['hit_rate'] == 1
    assert r['estimated_net_alpha'] is None


@pytest.mark.parametrize('score', [.8, .2])
def test_zero_alpha_is_not_a_directional_win(replay, score):
    r = replay({'ABC': series(), 'SPY': series()}, scores=(('ABC', score),), round_trip_cost_bps=0)['horizons']['5d']
    assert r['hit_rate'] == 0 and r['avg_alpha'] == r['estimated_net_alpha'] == 0


def test_delayed_entry_uses_calendar_horizon_and_exact_benchmark_dates(replay, monkeypatch):
    saturday = date(2026, 9, 26)
    monkeypatch.setattr(bt, 'list_snapshot_dates', lambda: [saturday])
    prices = ([date(2026, 9, 28), date(2026, 10, 1)], [100, 103])
    spy = (prices[0], [100, 101])
    r = replay({'ABC': prices, 'SPY': spy})['horizons']['5d']
    assert r['n'] == 1 and r['avg_alpha'] == .02


@pytest.mark.parametrize('cost', [-1, float('inf'), float('nan')])
def test_invalid_cost(replay, cost):
    assert 'error' in replay({}, round_trip_cost_bps=cost)


@pytest.mark.parametrize('horizons', [(), (0,), (-5,), (True,)])
def test_invalid_horizon(horizons):
    assert asyncio.run(bt.backtest_signal('unused', horizons=horizons))['error'] == 'horizons must be positive calendar-day integers'


def test_nonfinite_stock_window_is_not_a_benchmark_failure(replay):
    r = replay({'ABC': series(end=float('nan')), 'SPY': series()})['horizons']['5d']
    assert r['n'] == 0 and r['skipped_stock_window'] == 1
    assert r['skipped_benchmark_window'] == 0
