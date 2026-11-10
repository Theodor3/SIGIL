from types import SimpleNamespace

import pytest

from api.model import scorer
from api.signals.base import SignalOutput


def run(monkeypatch, outputs, weights=None, tilts=None, gates=None):
    monkeypatch.setattr(scorer, 'load_weights', lambda: dict(weights or {'a': 1.0}))
    return scorer.score_universe(outputs, {}, SimpleNamespace(factor_tilts=tilts or {}), gates)


def test_no_confident_signal_is_not_eligible_even_with_zero_threshold(monkeypatch):
    row = run(monkeypatch, {'a': [SignalOutput('ABC', .5, 0)]}, gates={'min_confidence': 0})[0]
    assert row.final_score == row.confidence == 0
    assert row.signal_scores == {}
    assert not row.eligible
    assert row.gate_flags == {'confidence': False, 'signal_evidence': False}


def test_unconfigured_signal_cannot_create_confidence(monkeypatch):
    row = run(monkeypatch, {'unknown': [SignalOutput('ABC', .9, 1)]})[0]
    assert row.confidence == 0 and not row.eligible


@pytest.mark.parametrize('weight', [0, -1, float('nan'), float('inf'), True, '1', 10**500])
def test_noncontributing_weight_does_not_count_as_evidence(monkeypatch, weight):
    row = run(monkeypatch, {'a': [SignalOutput('ABC', .9, 1)]}, weights={'a': weight})[0]
    assert row.confidence == 0 and not row.eligible


@pytest.mark.parametrize('field', ['score', 'confidence'])
@pytest.mark.parametrize('value', [float('nan'), float('inf'), -.1, 1.1, True, None, '0.8', 10**500])
def test_invalid_signal_is_not_evidence(monkeypatch, field, value):
    values = dict(ticker='ABC', score=.8, confidence=.9)
    values[field] = value
    row = run(monkeypatch, {'a': [SignalOutput(**values)]})[0]
    assert row.final_score == row.confidence == 0
    assert not row.eligible


@pytest.mark.parametrize('tilt', [0, -1, float('nan'), float('inf'), True, '1'])
def test_suppressed_or_invalid_tilt_is_not_evidence(monkeypatch, tilt):
    row = run(monkeypatch, {'a': [SignalOutput('ABC', .9, 1)]}, tilts={'a': tilt})[0]
    assert row.confidence == 0 and not row.eligible


def test_valid_weighted_ranking_and_regime_tilts_unchanged(monkeypatch):
    rows = run(monkeypatch, {
        'a': [SignalOutput('ABC', .8, .8), SignalOutput('XYZ', .5, .9)],
        'b': [SignalOutput('ABC', .2, .6), SignalOutput('XYZ', .6, .9)],
    }, weights={'a': .75, 'b': .25}, tilts={'a': 1.1, 'b': .9})
    by_ticker = {row.ticker: row for row in rows}
    # Original formula: sum(score * weight * confidence * tilt) / sum(weight * confidence).
    assert by_ticker['ABC'].final_score == .74
    assert by_ticker['ABC'].confidence == .7
    assert by_ticker['ABC'].eligible
    assert by_ticker['ABC'].signal_scores == {'a': .8, 'b': .2}
    assert by_ticker['ABC'].gate_flags['signal_evidence']
    assert [row.ticker for row in rows] == ['ABC', 'XYZ']


def test_zero_weight_high_confidence_cannot_rescue_low_confidence(monkeypatch):
    row = run(monkeypatch, {
        'a': [SignalOutput('ABC', .8, .4)],
        'b': [SignalOutput('ABC', 1, 1)],
    }, weights={'a': 1, 'b': 0})[0]
    assert row.confidence == .4 and not row.eligible
    assert row.gate_flags['signal_evidence']
    assert row.signal_scores == {'a': .8}


def test_neutral_with_real_confidence_is_still_scoring_evidence(monkeypatch):
    row = run(monkeypatch, {'a': [SignalOutput('ABC', .5, .8)]})[0]
    assert row.final_score == .5 and row.confidence == .8 and row.eligible


def test_empty_universe_remains_empty(monkeypatch):
    assert run(monkeypatch, {}) == []


def test_valid_signal_survives_invalid_neighbor(monkeypatch):
    row = run(monkeypatch, {
        'a': [SignalOutput('ABC', .8, .7)],
        'b': [SignalOutput('ABC', float('nan'), 1)],
    }, weights={'a': .5, 'b': .5})[0]
    assert row.final_score == .8 and row.confidence == .7 and row.eligible
    assert row.signal_scores == {'a': .8}


def test_caller_fallback_weight_is_evidence(monkeypatch):
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'configured': 1})
    row = scorer.score_universe(
        {'new': [SignalOutput('ABC', .8, .9)]}, {'new': .2},
        SimpleNamespace(factor_tilts={}),
    )[0]
    assert row.final_score == .8 and row.confidence == .9 and row.eligible
    assert row.signal_scores == {'new': .8}


def test_overflow_fails_closed_without_claiming_signal_evidence(monkeypatch):
    row = run(monkeypatch, {'a': [SignalOutput('ABC', 1, 1)]},
              weights={'a': 1e308}, tilts={'a': 1e308})[0]
    assert row.final_score == row.confidence == 0
    assert row.signal_scores == {} and not row.eligible
    assert not row.gate_flags['signal_evidence']
