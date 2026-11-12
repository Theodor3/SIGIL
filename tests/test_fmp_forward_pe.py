import asyncio
from types import SimpleNamespace

import pytest

from api.data import fmp
from api.signals.accounting_red_flags import AccountingRedFlagsSignal
from api.signals.earnings_miss_risk import EarningsMissRiskSignal
from api.signals.forward_value import ForwardValueSignal


@pytest.mark.parametrize('peg', [0.5, 2, 45, None, 'invalid'])
def test_fmp_does_not_mislabel_peg_as_forward_pe(monkeypatch, peg):
    async def fixture(client, endpoint, params):
        return {'profile': [{'symbol': 'TEST', 'sector': 'Industrials'}],
                'ratios-ttm': [{'priceToEarningsGrowthRatioTTM': peg, 'priceToEarningsRatioTTM': 24}]
                }.get(endpoint, [])
    monkeypatch.setattr(fmp, '_get', fixture)
    result = asyncio.run(fmp._fetch_ticker(None, 'TEST'))
    assert result['forward_pe'] is None
    assert result['trailing_pe'] == 24


@pytest.mark.parametrize('signal', [AccountingRedFlagsSignal(), EarningsMissRiskSignal()])
def test_missing_forward_pe_does_not_create_false_pe_gap(signal):
    def compute(forward_pe):
        ctx = SimpleNamespace(universe=['TEST'], fundamentals={'TEST': {
            'trailing_pe': 24, 'forward_pe': forward_pe, 'sector': 'Industrials'}},
            earnings_history={}, forward_estimates={})
        return asyncio.run(signal.compute(ctx))[0]
    corrected = compute(None)
    contaminated = compute(0.5)
    assert 'pe_gap_ratio' not in corrected.metadata
    assert 'pe_expansion_expected' not in corrected.metadata
    assert corrected.score > contaminated.score


def test_forward_value_uses_price_and_estimated_eps_not_fundamental_pe():
    def compute(pe):
        ctx = SimpleNamespace(universe=['TEST'], fundamentals={'TEST': {'sector': 'Industrials', 'forward_pe': pe}},
            market_data={'TEST': {'close': 100}}, forward_estimates={'TEST': {'estimated_eps_avg': 5}})
        return asyncio.run(ForwardValueSignal().compute(ctx))[0]
    before, after = compute(0.5), compute(None)
    assert after.metadata['forward_pe'] == 20
    assert (before.score, before.confidence, before.metadata) == (after.score, after.confidence, after.metadata)
