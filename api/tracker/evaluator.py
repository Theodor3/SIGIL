"""Signal evaluator — grades predictions against real returns at 5/20/60 day horizons."""
from __future__ import annotations

import asyncio
from bisect import bisect_left, bisect_right
from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SignalEvaluation, SignalPrediction

BENCHMARK = "SPY"
BATCH_LIMIT = 5000
# Drain up to this many batches per cycle so grading keeps pace with the
# ~2000-ticker universe instead of accumulating an unbounded backlog
MAX_BATCHES = 8

# Evaluations written before this moment came from the old simulated-return
# grader; purged once per process start so they never pollute real stats.
REAL_EVAL_EPOCH = datetime(2026, 7, 2)
_purge_done = False

# Predictions this far past their grading date with still no price data are
# marked ungradable (null returns) so they stop being retried every cycle
# (delisted or renamed tickers).
STALE_GRACE_DAYS = 30

# A prediction at exactly the 0.5 neutral score or with zero confidence is
# "no view", not a directional call — it must not be graded correct/incorrect.
NEUTRAL_SCORE_EPSILON = 1e-6
_neutral_reclass_done = False


def _is_neutral(score: float, confidence: float) -> bool:
    return confidence <= 0 or abs(score - 0.5) <= NEUTRAL_SCORE_EPSILON


def _download_history_sync(
    tickers: list[str], start: date, end: date
) -> dict[str, tuple[list[date], list[float]]]:
    """Fetch adjusted daily closes as {ticker: (dates, closes)}, sorted by date."""
    import yfinance as yf

    try:
        df = yf.download(
            tickers,
            start=start.isoformat(),
            end=(end + timedelta(days=1)).isoformat(),
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as e:
        print(f"[evaluator] Price download failed: {e}")
        return {}
    if df is None or df.empty:
        return {}

    history: dict[str, tuple[list[date], list[float]]] = {}
    for ticker in tickers:
        try:
            # group_by="ticker" yields MultiIndex columns even for a single
            # ticker on current yfinance; fall back to flat columns only
            # when the ticker level is genuinely absent
            if ticker in df.columns.get_level_values(0):
                tdf = df[ticker]
            elif len(tickers) == 1:
                tdf = df
            else:
                continue
            closes = tdf["Close"].dropna()
            if closes.empty:
                continue
            history[ticker] = (
                [d.date() for d in closes.index],
                [float(c) for c in closes.values],
            )
        except Exception:
            continue
    return history


def _price_on_or_after(
    series: tuple[list[date], list[float]], target: date, max_slip_days: int = 5
) -> tuple[date, float] | None:
    dates, closes = series
    i = bisect_left(dates, target)
    if i >= len(dates) or (dates[i] - target).days > max_slip_days:
        return None
    return dates[i], closes[i]


def _price_on_or_before(
    series: tuple[list[date], list[float]], target: date
) -> tuple[date, float] | None:
    dates, closes = series
    i = bisect_right(dates, target) - 1
    if i < 0:
        return None
    return dates[i], closes[i]


def _window_return(
    series: tuple[list[date], list[float]], run_date: date, horizon_days: int
) -> tuple[date, date, float] | None:
    """Compute (entry_date, exit_date, return) for run_date → run_date + horizon."""
    entry = _price_on_or_after(series, run_date)
    if entry is None:
        return None
    entry_date, entry_px = entry
    exit_ = _price_on_or_before(series, run_date + timedelta(days=horizon_days))
    if exit_ is None:
        return None
    exit_date, exit_px = exit_
    # Demand most of the horizon actually elapsed (thin/partial data guard)
    if (exit_date - entry_date).days < max(2, int(horizon_days * 0.6)):
        return None
    if entry_px <= 0:
        return None
    return entry_date, exit_date, exit_px / entry_px - 1.0


async def _purge_simulated_evaluations(db: AsyncSession) -> None:
    global _purge_done
    if _purge_done:
        return
    result = await db.execute(
        delete(SignalEvaluation).where(SignalEvaluation.evaluated_at < REAL_EVAL_EPOCH)
    )
    await db.commit()
    _purge_done = True
    if result.rowcount:
        print(f"[evaluator] Purged {result.rowcount} simulated evaluations")


async def _reclassify_neutral_evaluations(db: AsyncSession) -> None:
    """One-time cleanup: evaluations of neutral predictions were graded as
    directional calls by the old rule — null their signal_correct so stats
    only count real calls. Return/alpha data is kept."""
    global _neutral_reclass_done
    if _neutral_reclass_done:
        return
    neutral_ids = select(SignalPrediction.id).where(
        or_(
            SignalPrediction.confidence <= 0,
            func.abs(SignalPrediction.score - 0.5) <= NEUTRAL_SCORE_EPSILON,
        )
    )
    result = await db.execute(
        update(SignalEvaluation)
        .where(
            SignalEvaluation.prediction_id.in_(neutral_ids),
            SignalEvaluation.signal_correct.is_not(None),
        )
        .values(signal_correct=None)
    )
    await db.commit()
    _neutral_reclass_done = True
    if result.rowcount:
        print(f"[evaluator] Reclassified {result.rowcount} neutral evaluations as non-calls")


async def evaluate_predictions(db: AsyncSession, horizon_days: int = 5) -> dict:
    """Grade all due predictions against real prices, draining in batches."""
    await _purge_simulated_evaluations(db)
    await _reclassify_neutral_evaluations(db)

    totals = {"evaluated": 0, "skipped_no_data": 0, "marked_ungradable": 0,
              "horizon_days": horizon_days}
    for _ in range(MAX_BATCHES):
        batch = await _evaluate_batch(db, horizon_days)
        if "error" in batch:
            totals["error"] = batch["error"]
            break
        totals["evaluated"] += batch["evaluated"]
        totals["skipped_no_data"] = batch.get("skipped_no_data", 0)
        totals["marked_ungradable"] += batch.get("marked_ungradable", 0)
        # Stop when nothing was graded: either fully drained or only
        # missing-data predictions remain (retrying them now would spin)
        if batch["evaluated"] + batch.get("marked_ungradable", 0) == 0:
            break
    return totals


async def _evaluate_batch(db: AsyncSession, horizon_days: int) -> dict:
    cutoff = date.today() - timedelta(days=horizon_days)

    already_eval = select(SignalEvaluation.prediction_id).where(
        SignalEvaluation.horizon_days == horizon_days
    )
    ungraded_q = await db.execute(
        select(SignalPrediction)
        .where(SignalPrediction.run_date <= cutoff)
        .where(~SignalPrediction.id.in_(already_eval))
        # Newest first: no-data stragglers (delisted tickers awaiting the
        # stale grace period) sink to the tail instead of forming a block
        # at the queue head that starves every fresh prediction behind it
        .order_by(SignalPrediction.run_date.desc())
        .limit(BATCH_LIMIT)
    )
    ungraded = ungraded_q.scalars().all()

    if not ungraded:
        return {"evaluated": 0, "horizon_days": horizon_days}

    tickers = sorted({p.ticker for p in ungraded})
    start = min(p.run_date for p in ungraded) - timedelta(days=7)
    loop = asyncio.get_running_loop()
    history = await loop.run_in_executor(
        None, _download_history_sync, tickers + [BENCHMARK], start, date.today()
    )
    benchmark = history.get(BENCHMARK)
    if benchmark is None:
        print("[evaluator] No benchmark price data; skipping evaluation cycle")
        return {"evaluated": 0, "horizon_days": horizon_days, "error": "no benchmark data"}

    stale_cutoff = date.today() - timedelta(days=horizon_days + STALE_GRACE_DAYS)
    window_cache: dict[tuple[str, date], tuple[date, date, float] | None] = {}
    now = datetime.utcnow()
    evaluated = skipped = ungradable = 0

    for pred in ungraded:
        key = (pred.ticker, pred.run_date)
        if key not in window_cache:
            series = history.get(pred.ticker)
            window_cache[key] = (
                _window_return(series, pred.run_date, horizon_days) if series else None
            )
        window = window_cache[key]

        if window is None:
            if pred.run_date <= stale_cutoff:
                # No prices long after the horizon passed — stop retrying
                db.add(SignalEvaluation(
                    prediction_id=pred.id,
                    horizon_days=horizon_days,
                    evaluated_at=now,
                ))
                ungradable += 1
            else:
                skipped += 1
            continue

        entry_date, exit_date, actual_return = window

        alpha = None
        bench_entry = _price_on_or_before(benchmark, entry_date)
        bench_exit = _price_on_or_before(benchmark, exit_date)
        if bench_entry and bench_exit and bench_entry[1] > 0 and bench_exit[0] > bench_entry[0]:
            alpha = actual_return - (bench_exit[1] / bench_entry[1] - 1.0)

        # Scores are 0..1 with 0.5 neutral: above-neutral should beat the
        # benchmark, below-neutral should not. Neutral / zero-confidence
        # predictions made no call, so they get no correctness grade.
        basis = alpha if alpha is not None else actual_return
        if _is_neutral(pred.score, pred.confidence):
            signal_correct = None
        else:
            signal_correct = (pred.score > 0.5) == (basis > 0)

        db.add(SignalEvaluation(
            prediction_id=pred.id,
            horizon_days=horizon_days,
            actual_return=round(actual_return, 6),
            signal_correct=signal_correct,
            alpha_vs_benchmark=round(alpha, 6) if alpha is not None else None,
            evaluated_at=now,
        ))
        evaluated += 1

    await db.commit()
    return {
        "evaluated": evaluated,
        "skipped_no_data": skipped,
        "marked_ungradable": ungradable,
        "horizon_days": horizon_days,
    }


async def get_signal_stats(db: AsyncSession) -> dict[str, dict]:
    """Compute hit rate and avg directional alpha per signal from evaluations.

    Only real directional calls count (signal_correct is null for neutral
    predictions). Alpha is signed by the call direction — the alpha earned by
    following the signal — so it differentiates signals instead of measuring
    the shared ticker universe.

    Stats are split by signal_version: the headline horizon keys ("5d"...)
    describe ONLY the currently deployed version, so a rewritten signal
    starts a clean record instead of inheriting its predecessor's grades.
    Older versions' records are preserved under "prior_versions".
    """
    evals_q = await db.execute(
        select(
            SignalPrediction.signal_name,
            SignalPrediction.signal_version,
            SignalPrediction.score,
            SignalEvaluation.horizon_days,
            SignalEvaluation.signal_correct,
            SignalEvaluation.alpha_vs_benchmark,
        )
        .join(SignalPrediction, SignalPrediction.id == SignalEvaluation.prediction_id)
        .where(SignalEvaluation.actual_return.is_not(None))
        .where(SignalEvaluation.signal_correct.is_not(None))
    )
    rows = evals_q.all()

    # (name, version, horizon) buckets
    buckets: dict[str, dict[str, dict[int, list]]] = {}
    for signal_name, version, score, horizon, correct, alpha in rows:
        directional_alpha = None
        if alpha is not None:
            directional_alpha = alpha if score > 0.5 else -alpha
        buckets.setdefault(signal_name, {}).setdefault(
            version or "unknown", {}
        ).setdefault(horizon, []).append((correct, directional_alpha))

    def _summarize(horizons: dict[int, list]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for horizon, entries in sorted(horizons.items()):
            n = len(entries)
            hit_count = sum(1 for c, _ in entries if c)
            alphas = [a for _, a in entries if a is not None]
            avg_alpha = sum(alphas) / len(alphas) if alphas else 0
            out[f"{horizon}d"] = {
                "n": n,
                "hit_rate": round(hit_count / n, 4) if n else 0,
                "avg_alpha": round(avg_alpha, 6),
            }
        return out

    from api.signals.registry import get_registry
    registry = get_registry()

    stats: dict[str, dict] = {}
    for name, versions in buckets.items():
        live = registry.get(name)
        # Deployed version defines the headline; for retired signals fall
        # back to the newest version present in the data
        current = live.version if live else max(versions)

        entry: dict = dict(_summarize(versions.get(current, {})))
        entry["current_version"] = current

        prior = {
            v: _summarize(horizons)
            for v, horizons in versions.items()
            if v != current
        }
        if prior:
            entry["prior_versions"] = prior
        stats[name] = entry
    return stats
