"""Synthetic scorer-to-order-plan impact; never imports a broker or submits orders."""
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace

import pytest

from api.execution.rebalancer import compute_rebalance
from api.model import scorer
from api.model.portfolio import PortfolioConstraints, construct_portfolio
from api.model.score_snapshot import build_score_snapshot
from api.signals.base import SignalOutput


def candidates(monkeypatch, active, disabled):
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'active': 1.0, 'disabled': 0.0})
    outputs = {'active': [SignalOutput('SYNTH', .8, active)],
               'disabled': [SignalOutput('SYNTH', .2, disabled)]}
    current = scorer.score_universe(outputs, {}, SimpleNamespace(factor_tilts={}))[0]
    # Exact baseline gate for these two valid outputs: all positive confidences
    # were averaged even when the signal had zero portfolio weight.
    baseline_confidence = (active + disabled) / 2
    baseline = replace(current, confidence=round(baseline_confidence, 4),
                       eligible=baseline_confidence >= .58)
    return baseline, current


def plan(row, held=0, rank=1, keep_rank=50, turnover=None):
    constraints = PortfolioConstraints(max_position_pct=1, max_sector_pct=1)
    targets = construct_portfolio([row], 10000, {'SYNTH': 100}, {'SYNTH': 'Synthetic'}, constraints)
    return compute_rebalance(
        current_positions={'SYNTH': {'shares': held, 'market_value': held * 100}} if held else {},
        target_weights={t.ticker: t.weight for t in targets}, prices={'SYNTH': 100},
        portfolio_value=10000, cash=10000-held*100, exposure_target=1,
        ranks={'SYNTH': rank}, keep_rank=keep_rank, max_turnover_pct=turnover)


def test_disabled_confidence_no_longer_creates_new_buy(monkeypatch):
    old, new = candidates(monkeypatch, .4, 1)
    assert old.final_score == new.final_score == .8
    assert old.eligible and not new.eligible
    assert [(o.side, o.shares) for o in plan(old).buys] == [('buy', 100)]
    assert not plan(new).buys and not plan(new).sells


def test_disabled_low_confidence_no_longer_suppresses_new_buy(monkeypatch):
    old, new = candidates(monkeypatch, .9, .1)
    assert not old.eligible and new.eligible
    assert not plan(old).buys
    assert [(o.reason, o.shares) for o in plan(new).buys] == [('new', 100)]


@pytest.mark.parametrize('rank,exit_expected', [(1, False), (50, False), (51, True)])
def test_lost_eligibility_respects_existing_rank_hysteresis(monkeypatch, rank, exit_expected):
    old, new = candidates(monkeypatch, .4, 1)
    assert not plan(old, held=100, rank=rank).sells
    after = plan(new, held=100, rank=rank)
    assert not after.buys
    if exit_expected:
        assert [(o.reason, o.shares) for o in after.sells] == [('exit', 100)]
    else:
        assert not after.sells
        assert after.skipped[0]['reason'] == 'hysteresis_hold'


def test_eligibility_exit_still_obeys_turnover_limit(monkeypatch):
    _, new = candidates(monkeypatch, .4, 1)
    after = plan(new, held=100, rank=51, turnover=.1)
    assert after.total_sell_value == 0
    assert not after.sells and not after.buys
    assert after.skipped[0]['reason'] == 'turnover_cap'


def test_snapshot_capture_does_not_mutate_order_plan(monkeypatch):
    _, new = candidates(monkeypatch, .9, .1)
    original = deepcopy(new)
    before = plan(new)
    packet = build_score_snapshot('synthetic', [new], {}, '2026-11-09T12:00:00Z')
    assert packet['rows'][0]['eligible'] is True
    assert new == original
    assert plan(new) == before


def test_no_evidence_never_produces_a_buy(monkeypatch):
    monkeypatch.setattr(scorer, 'load_weights', lambda: {'disabled': 0.0})
    row = scorer.score_universe({'disabled': [SignalOutput('SYNTH', .8, 1)]}, {},
                                SimpleNamespace(factor_tilts={}))[0]
    assert not row.eligible and row.final_score == 0
    assert not plan(row).buys
