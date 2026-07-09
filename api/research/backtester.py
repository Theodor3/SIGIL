"""Signal backtester — replay a signal over recorded pipeline contexts.

For each archived context (what the pipeline actually saw on that date),
run the signal's compute(), take its non-neutral calls, and grade them
against real subsequent prices vs SPY using the SAME window/alpha math as
the live evaluator. Backtest numbers and forward numbers are therefore
directly comparable — which is what the promotion gates in
alpha_model.json need to mean anything.
"""
from __future__ import annotations

import asyncio
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
) -> dict:
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
    if benchmark is None:
        return {"error": "no benchmark price data"}

    # Phase 3: grade with the live evaluator's exact window/alpha math
    results: dict[str, dict] = {}
    for horizon in horizons:
        cutoff = date.today() - timedelta(days=horizon)
        entries = []
        window_cache: dict[tuple[str, date], tuple | None] = {}
        for d, ticker, score in calls:
            if d > cutoff:
                continue
            key = (ticker, d)
            if key not in window_cache:
                series = history.get(ticker)
                window_cache[key] = (
                    _window_return(series, d, horizon) if series else None
                )
            window = window_cache[key]
            if window is None:
                continue
            entry_date, exit_date, actual_return = window

            alpha = None
            b_in = _price_on_or_before(benchmark, entry_date)
            b_out = _price_on_or_before(benchmark, exit_date)
            if b_in and b_out and b_in[1] > 0 and b_out[0] > b_in[0]:
                alpha = actual_return - (b_out[1] / b_in[1] - 1.0)
            basis = alpha if alpha is not None else actual_return
            correct = (score > 0.5) == (basis > 0)
            directional_alpha = None
            if alpha is not None:
                directional_alpha = alpha if score > 0.5 else -alpha
            entries.append((correct, directional_alpha, score > 0.5))

        n = len(entries)
        if n == 0:
            results[f"{horizon}d"] = {"n": 0}
            continue
        alphas = [a for _, a, _ in entries if a is not None]
        longs = [e for e in entries if e[2]]
        shorts = [e for e in entries if not e[2]]
        results[f"{horizon}d"] = {
            "n": n,
            "hit_rate": round(sum(1 for c, _, _ in entries if c) / n, 4),
            "avg_alpha": round(sum(alphas) / len(alphas), 6) if alphas else 0,
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
        "signal": signal_name,
        "version": signal.version,
        "snapshots_usable": len(usable),
        "snapshots_replayed": replayed,
        "total_calls": len(calls),
        "date_range": [usable[0].isoformat(), usable[-1].isoformat()],
        "horizons": results,
    }
