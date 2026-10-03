"""Signal backtester — replay a signal over recorded pipeline contexts.

For each archived context (what the pipeline actually saw on that date),
run the signal's compute(), take its non-neutral calls, and grade them
against subsequent prices vs SPY. Only matched benchmark dates contribute
to headline metrics. Optional costs are a forecast screening assumption,
not a portfolio simulation or evidence of executable returns.
"""
from __future__ import annotations

import asyncio
import math
from datetime import date, timedelta

from api.research.context_store import list_snapshot_dates, load_context
from api.signals.registry import get_registry
from api.tracker.evaluator import (
    BENCHMARK,
    _download_history_sync,
    _price_on_or_before,
    _window_return,
)

NEUTRAL_EPSILON = 1e-6


async def backtest_signal(
    signal_name: str,
    horizons: tuple[int, ...] = (5, 20),
    max_snapshots: int = 250,
    round_trip_cost_bps: float | None = None,
) -> dict:
    if not horizons or any(type(h) is not int or h <= 0 for h in horizons):
        return {"error": "horizons must be positive calendar-day integers"}
    if type(max_snapshots) is not int or max_snapshots <= 0:
        return {"error": "max_snapshots must be a positive integer"}
    if round_trip_cost_bps is not None and (
        not math.isfinite(round_trip_cost_bps) or round_trip_cost_bps < 0
    ):
        return {"error": "round_trip_cost_bps must be finite and nonnegative"}
    registry = get_registry()
    signal = registry.get(signal_name)
    if signal is None:
        return {"error": f"unknown signal: {signal_name}"}

    all_dates = list_snapshot_dates()
    min_horizon = min(horizons)
    usable = [d for d in all_dates if d <= date.today() - timedelta(days=min_horizon)]
    usable = usable[-max_snapshots:]
    if not usable:
        return {
            "signal": signal_name,
            "version": signal.version,
            "snapshots_available": len(all_dates),
            "snapshots_usable": 0,
            "note": "No snapshots old enough to grade yet — they accumulate "
                    "one per pipeline run and become usable once the shortest "
                    "horizon has elapsed.",
        }

    # Phase 1: replay compute() over each recorded context
    calls: list[tuple[date, str, float]] = []  # (as_of, ticker, score)
    replayed = 0
    for d in usable:
        ctx = load_context(d)
        if ctx is None:
            continue
        try:
            outputs = await signal.compute(ctx)
        except Exception as e:
            print(f"[backtest] {signal_name} failed on {d}: {e}")
            continue
        replayed += 1
        for out in outputs:
            if out.confidence <= 0 or abs(out.score - 0.5) <= NEUTRAL_EPSILON:
                continue
            calls.append((d, out.ticker, out.score))

    if not calls:
        return {
            "signal": signal_name,
            "version": signal.version,
            "snapshots_usable": len(usable),
            "snapshots_replayed": replayed,
            "note": "Signal made no non-neutral calls on recorded data.",
        }

    # Phase 2: one batched price download covering every call window
    tickers = sorted({t for _, t, _ in calls})
    start = min(d for d, _, _ in calls) - timedelta(days=7)
    loop = asyncio.get_running_loop()
    history = await loop.run_in_executor(
        None, _download_history_sync, tickers + [BENCHMARK], start, date.today()
    )
    benchmark = history.get(BENCHMARK)

    # Phase 3: retain calendar windows, but require matched benchmark evidence.
    results: dict[str, dict] = {}
    for horizon in horizons:
        cutoff = date.today() - timedelta(days=horizon)
        entries = []
        eligible = missing_stock = missing_benchmark = 0
        window_cache: dict[tuple[str, date], tuple | None] = {}
        for d, ticker, score in calls:
            if d > cutoff:
                continue
            eligible += 1
            key = (ticker, d)
            if key not in window_cache:
                series = history.get(ticker)
                window_cache[key] = (
                    _window_return(series, d, horizon) if series else None
                )
            window = window_cache[key]
            if window is None or not math.isfinite(window[2]):
                missing_stock += 1
                continue
            entry_date, exit_date, actual_return = window

            b_in = _price_on_or_before(benchmark, entry_date) if benchmark else None
            b_out = _price_on_or_before(benchmark, exit_date) if benchmark else None
            if not (b_in and b_out and b_in[0] == entry_date
                    and b_out[0] == exit_date and exit_date > entry_date
                    and all(math.isfinite(p) and p > 0 for p in (b_in[1], b_out[1]))):
                missing_benchmark += 1
                continue
            alpha = actual_return - (b_out[1] / b_in[1] - 1.0)
            directional_alpha = alpha if score > 0.5 else -alpha
            correct = directional_alpha > 0
            entries.append((correct, directional_alpha, score > 0.5))

        n = len(entries)
        alphas = [a for _, a, _ in entries if a is not None]
        longs = [e for e in entries if e[2]]
        shorts = [e for e in entries if not e[2]]
        results[f"{horizon}d"] = {
            "n": n,
            "eligible_calls": eligible,
            "skipped_stock_window": missing_stock,
            "skipped_benchmark_window": missing_benchmark,
            "alpha_n": len(alphas),
            "hit_rate": round(sum(1 for c, _, _ in entries if c) / n, 4) if n else None,
            "avg_alpha": round(sum(alphas) / len(alphas), 6) if alphas else None,
            "estimated_net_alpha": round(sum(alphas) / len(alphas) - round_trip_cost_bps / 10000, 6)
            if alphas and round_trip_cost_bps is not None else None,
            "long_calls": len(longs),
            "short_calls": len(shorts),
            "long_hit_rate": round(
                sum(1 for c, _, _ in longs if c) / len(longs), 4
            ) if longs else None,
            "short_hit_rate": round(
                sum(1 for c, _, _ in shorts if c) / len(shorts), 4
            ) if shorts else None,
        }

    return {
        "schema_version": 2,
        "methodology": {
            "horizon_unit": "calendar_days",
            "hit_basis": "strictly_positive_SPY_relative_directional_alpha",
            "benchmark_policy": "exact_stock_entry_and_exit_dates",
            "round_trip_cost_bps": round_trip_cost_bps,
            "cost_scope": "Flat assumed round-trip cost per forecast, including any assumed fees, spread, slippage and borrow. Not measured execution or portfolio returns.",
            "timing_limit": "Date-only snapshots do not establish intraday availability. Overlapping calls are not independent observations.",
        },
        "signal": signal_name,
        "version": signal.version,
        "snapshots_usable": len(usable),
        "snapshots_replayed": replayed,
        "total_calls": len(calls),
        "date_range": [usable[0].isoformat(), usable[-1].isoformat()],
        "horizons": results,
    }
