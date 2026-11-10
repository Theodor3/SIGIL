"""Version 1 synthetic-only eligibility shadow; no prices, accounts or services."""
import hashlib
import importlib.util
import json
import sys
import warnings
from datetime import date
from pathlib import Path

import pytest
from api.model import scorer
from api.model.portfolio import PortfolioConstraints, target_weights
from api.regime.models import RegimeSnapshot
from api.signals.base import SignalOutput

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "tests/shadow_fixtures/baseline_scorer_26531a3.py"


def baseline_module():
    spec = importlib.util.spec_from_file_location("shadow_baseline", BASELINE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    module._CONFIG_PATH = scorer._CONFIG_PATH
    return module


def synthetic_inputs(case):
    # All names and sectors are fictional. One sparse active and one disabled
    # signal per name; weights are loaded unmodified from current alpha config.
    count = 16 if case == "capacity_loss" else 24
    active, disabled, sectors = [], [], {}
    for i in range(count):
        ticker = f"SYNTH_{i:02d}"
        a, z = 0.8, 0.8
        if case != "control" and i < 4:
            a, z = 0.4, 1.0
        elif case == "mixed_flips" and i < 8:
            a, z = 0.9, 0.1
        active.append(SignalOutput(ticker, round(0.95 - 0.015*i, 6), a))
        disabled.append(SignalOutput(ticker, 0.5, z))
        sectors[ticker] = f"FictionalSector_{i % 5}"
    return {"value": active, "alt_momentum": disabled}, sectors


def compare(case):
    old = baseline_module()
    signals, sectors = synthetic_inputs(case)
    regime = RegimeSnapshot(date(2026, 11, 9), "synthetic_neutral", 1.0, 1.0,
                            factor_tilts={})
    gates = json.loads(scorer._CONFIG_PATH.read_text())["gates"]
    before = old.score_universe(signals, {}, regime, gates)
    after = scorer.score_universe(signals, {}, regime, gates)
    constraints = PortfolioConstraints()
    b, a = target_weights(before, sectors, constraints), target_weights(after, sectors, constraints)
    bm, am = {s.ticker:s for s in before}, {s.ticker:s for s in after}
    union = sorted(set(b)|set(a))
    deltas = {t:a.get(t,0)-b.get(t,0) for t in union}
    cb, ca = 1-sum(b.values()), 1-sum(a.values())
    l1 = sum(abs(v) for v in deltas.values())
    summary = {
        "case":case,"universe":len(before),
        "eligible_before":sum(s.eligible for s in before),
        "eligible_after":sum(s.eligible for s in after),
        "eligibility_added":[t for t in bm if not bm[t].eligible and am[t].eligible],
        "eligibility_removed":[t for t in bm if bm[t].eligible and not am[t].eligible],
        "target_added":sorted(set(a)-set(b)),"target_removed":sorted(set(b)-set(a)),
        "target_count_before":len(b),"target_count_after":len(a),
        "retained_reweighted":sum(abs(deltas[t])>1e-10 for t in set(a)&set(b)),
        "cash_before":cb,"cash_after":ca,"equity_L1":l1,
        "one_way_including_cash":(l1+abs(ca-cb))/2,
        "target_weights_before":b,"target_weights_after":a,
        "max_score_delta":max(abs(bm[t].final_score-am[t].final_score) for t in bm),
    }
    for book in (b,a):
        assert max(book.values()) <= constraints.max_position_pct + 1e-9
        for sector in set(sectors.values()):
            assert sum(w for t,w in book.items() if sectors[t]==sector) <= constraints.max_sector_pct+1e-9
    assert summary["max_score_delta"] == 0
    return summary


@pytest.mark.parametrize("case", ["control", "mixed_flips", "capacity_loss"])
def test_shadow(case):
    result = compare(case)
    if case == "control":
        assert result["equity_L1"] == 0
        assert result["target_count_before"] == result["target_count_after"] == 20
    elif case == "mixed_flips":
        assert len(result["eligibility_added"]) == len(result["eligibility_removed"]) == 4
        assert len(result["target_added"]) == len(result["target_removed"]) == 4
        assert result["retained_reweighted"] == 16
    else:
        assert result["target_count_before"] == 16
        assert result["target_count_after"] == 12
        assert result["cash_after"] == pytest.approx(0.04)
    warnings.warn("SHADOW_RESULT " + json.dumps(result, sort_keys=True))


def test_frozen_baseline_and_config_provenance():
    # Git blob SHA-1 checks exact repository bytes, including line endings.
    data = BASELINE.read_bytes()
    assert hashlib.sha1(b"blob " + str(len(data)).encode()+b"\0"+data).hexdigest() == "e4a0c73922d1aba29172fb82dbfe666fcacb6193"
    weights = scorer.load_weights()
    assert weights["value"] == pytest.approx(0.30*1.2/5.8)
    assert weights["alt_momentum"] == 0
    assert sum(weights.values()) == pytest.approx(1)
