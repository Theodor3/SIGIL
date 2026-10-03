import asyncio
from types import SimpleNamespace

import pytest

from api.signals.debt_distress import DebtDistressSignal
from api.signals.earnings_miss_risk import EarningsMissRiskSignal


def evaluate(signal, fundamentals, estimates=None):
    ctx = SimpleNamespace(universe=['TEST'], fundamentals={'TEST': fundamentals},
                          earnings_history={}, forward_estimates={'TEST': estimates or {}})
    return asyncio.run(signal.compute(ctx))[0]


@pytest.mark.parametrize('low,high,average,penalty', [
    (0, 2, 1, .2), (-2, 0, 1, .2), (1, 2, 2, 0),
    (0, 1, 1, .1), (-1, 1, 1, .2), (1, 2.01, 2, .1),
])
def test_eps_spread_accepts_zero_bounds(low, high, average, penalty):
    out = evaluate(EarningsMissRiskSignal(), {'forward_pe': 10}, {
        'estimated_eps_low': low, 'estimated_eps_high': high, 'estimated_eps_avg': average})
    assert out.score == pytest.approx(1 - penalty)
    assert out.metadata['eps_estimate_spread'] == round((high-low)/average, 2)


@pytest.mark.parametrize('low,high,average', [(None, 2, 1), (0, None, 1), (0, 2, None), (0, 2, 0), (0, 2, -1)])
def test_incomplete_or_nonpositive_average_does_not_compute_spread(low, high, average):
    out = evaluate(EarningsMissRiskSignal(), {'forward_pe': 10}, {
        'estimated_eps_low': low, 'estimated_eps_high': high, 'estimated_eps_avg': average})
    assert 'eps_estimate_spread' not in out.metadata
    assert out.score == 1


@pytest.mark.parametrize('signal', [DebtDistressSignal(), EarningsMissRiskSignal()])
def test_empty_fundamentals_are_neutral(signal):
    out = evaluate(signal, {})
    assert out.score == .5 and out.confidence == 0


@pytest.mark.parametrize('signal', [DebtDistressSignal(), EarningsMissRiskSignal()])
def test_characterize_unrelated_fundamental_as_low_risk(signal):
    # Existing behavior, not an endorsed missing-data policy.
    out = evaluate(signal, {'market_cap': 100})
    assert out.score == 1 and out.confidence > 0
    assert out.metadata['risk'] == 'low'


def test_characterize_negative_equity_ratio():
    # Existing behavior requires a separate economic policy decision.
    out = evaluate(DebtDistressSignal(), {'debt_to_equity': -2})
    assert out.score == 1 and out.metadata['risk'] == 'low'
