import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location("screen", Path(__file__).with_name("screen.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def row(**changes):
    result = dict(candidate="pead:v1:frozen", ticker="AAA", receipt="sha256:fixture-only",
                  forecast_id="fixture-1", forecast_created_at="2026-09-01T22:00:00Z", available_at="2026-09-01T21:00:00Z",
                  entry_at="2026-09-02T13:30:00Z", exit_at="2026-09-22T20:00:00Z",
                  benchmark_entry_at="2026-09-02T13:30:00Z", benchmark_exit_at="2026-09-22T20:00:00Z",
                  direction=1, stock_return=.02, benchmark_return=.01)
    return result | changes


def run(rows, **kwargs):
    return module.screen(rows, candidate="pead:v1:frozen", frozen_at="2026-06-01T00:00:00Z", holdout_at="2026-09-01T00:00:00Z", **kwargs)


def test_costs_and_short_direction():
    result = run([row(), row(ticker="BBB", forecast_id="2", direction=-1, stock_return=0)])
    holdout = result["periods"]["holdout"]
    assert holdout["date_equal_weight_gross_alpha"] == pytest.approx(.01)
    assert holdout["date_equal_weight_net_alpha"]["25"] == pytest.approx(.0075)
    assert holdout["shorts"] == 1
    assert result["accepted_as_alpha"] is False


@pytest.mark.parametrize("changes", [dict(available_at="2026-09-02T14:00:00Z"),
    dict(available_at="2026-09-01"), dict(benchmark_entry_at="2026-09-01T13:30:00Z"),
    dict(stock_return=float("nan")), dict(direction=True), dict(stock_return=-1.1), dict(receipt="")])
def test_invalid_evidence_excluded(changes):
    result = run([row(**changes)])
    assert result["excluded"] == {"invalid_or_duplicate": 1}
    assert result["periods"]["holdout"]["forecasts"] == 0


def test_duplicate_and_overlapping_ticker_do_not_inflate_sample():
    result = run([row(), row(), row(forecast_id="other", ticker=" aaa ")])
    assert result["periods"]["holdout"]["forecasts"] == 1
    assert result["excluded"] == {"duplicate_id_all_rows": 2}


def test_purge_boundary_and_distinct_development():
    old = row(forecast_created_at="2026-07-01T21:00:00Z", available_at="2026-07-01T20:00:00Z", entry_at="2026-07-02T13:30:00Z",
              exit_at="2026-07-22T20:00:00Z", benchmark_entry_at="2026-07-02T13:30:00Z",
              benchmark_exit_at="2026-07-22T20:00:00Z")
    leaking = old | dict(forecast_id="leak", entry_at="2026-07-31T13:30:00Z", benchmark_entry_at="2026-07-31T13:30:00Z", exit_at="2026-08-20T20:00:00Z", benchmark_exit_at="2026-08-20T20:00:00Z")
    result = run([old, leaking])
    assert result["periods"]["development"]["forecasts"] == 1
    assert result["excluded"]["purged_boundary"] == 1


def test_dates_equal_weighted_and_negative_after_costs():
    one = row(stock_return=.011)
    two = row(ticker="BBB", forecast_id="two", stock_return=.009)
    result = run([one, two])
    assert result["periods"]["holdout"]["entry_dates"] == 1
    assert result["periods"]["holdout"]["date_equal_weight_net_alpha"]["25"] == pytest.approx(-.0025)


def test_empty_and_invalid_options():
    assert run([])["periods"]["holdout"]["date_equal_weight_gross_alpha"] is None
    with pytest.raises(ValueError):
        run([], costs_bps=[float("inf")])
    with pytest.raises(ValueError):
        run([], purge_days=-1)


def test_forecast_must_exist_before_entry_and_fixed_horizon():
    for changes in (dict(forecast_created_at="2026-09-02T14:00:00Z"),
                    dict(exit_at="2026-10-22T20:00:00Z"),
                    dict(forecast_created_at="2026-05-01T22:00:00Z")):
        assert run([row(**changes)])["excluded"] == {"invalid_or_duplicate": 1}


def test_conflicting_duplicates_are_order_independent():
    first, second = row(), row(direction=-1, stock_return=.9)
    assert run([first, second]) == run([second, first])
    assert run([first, second])["periods"]["holdout"]["forecasts"] == 0


def test_large_finite_values_do_not_overflow_mean():
    result = run([row(stock_return=1e308), row(ticker="BBB", forecast_id="2", stock_return=1e308)])
    assert result["periods"]["holdout"]["date_equal_weight_gross_alpha"] == 1e308


def test_overlap_different_ids_and_ticker_canonicalization():
    result = run([row(), row(forecast_id="later", ticker=" aaa ")])
    assert result["excluded"] == {"overlapping_ticker": 1}

