"""Machine-readable export of the target book, for an external executor.

This exists because the alternative is screenshotting the dashboard, and the
dashboard is the wrong number to read. /api/dashboard-data ranks its Top Ideas
with its own flat weighted sum, which skips the regime factor tilts, the
confidence weighting, the normalisation by total weight, and the eligibility
gate that score_universe applies -- and it never sees the watchlist exclusion or
the position and sector caps. It is a research view. What SIGIL actually intends
to hold comes out of score_universe -> target_weights, and that is what this
route serves.

Two design choices worth keeping:

Weights, not share counts. The consumer holds a different book of a different
size at a different broker; share counts computed against this account's equity
would be wrong for it. It diffs these weights against its own positions.

`changes`. A snapshot has no memory, and the consumer is a daily brief, for which
the new information is what moved rather than what is held. The book of an older
run is rebuilt through the same construction path and diffed, so the comparison
isolates the model changing its mind: everything outside the run -- watchlist,
sector map, registry weights -- is held at its current value on both sides.

`actionable` and `blocks`. SIGIL declines to trade under conditions a screenshot
cannot show -- a pipeline run that never completed, targets several days stale,
a closed market. An executor reading a picture cannot tell "here are today's
targets" from "this is three days old and SIGIL itself would refuse". Those
reasons are stated here so the consumer inherits the same guards rather than
routing around them.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import cache
from api.config.settings import settings
from api.db import get_db
from api.db.models import PipelineRun, SignalPrediction

router = APIRouter(prefix="/api/agent", tags=["agent"])

# 2 adds `changes`: what moved since a comparison run. Additive -- every v1 field
# keeps its meaning, so an existing consumer reads a v2 payload unchanged.
SCHEMA_VERSION = 2

# The scoring pass reads every prediction from the last run and rescores the
# universe. The underlying run only changes on the pipeline's own cadence, so a
# short TTL costs nothing in freshness and stops a polling consumer from paying
# for that work on every call. Kept well under a minute so the market-hours block
# does not go noticeably stale.
CACHE_KEY = "agent_book"
CACHE_TTL = 45


@router.get("/book")
async def get_book(db: AsyncSession = Depends(get_db)):
    """The intended portfolio as target weights, plus whether to act on it."""
    cached = cache.get(CACHE_KEY)
    if cached is not None:
        return cached

    payload = await _build_book(db)
    cache.set(CACHE_KEY, payload, ttl=CACHE_TTL)
    return payload


@dataclass
class _Constructed:
    """One run's book, rebuilt through the construction path."""
    book: dict[str, float]
    scored: list
    regime_id: str
    regime_confidence: float
    exposure: float
    sector_lookup_failed: bool


async def _construct(db: AsyncSession, run: PipelineRun,
                     watch: set[str]) -> _Constructed:
    """Rebuild what SIGIL would hold out of one completed run.

    Both the published book and the run it is diffed against come through here,
    so the comparison isolates what actually changed. Everything outside the run
    -- the watchlist, the sector map, the registry weights -- is held at its
    current value for both, which means a diff reports the model changing its
    mind and never the operator editing a watchlist.
    """
    from api.data.sectors import sectors_for_construction
    from api.model.portfolio import target_weights
    from api.model.scorer import score_universe
    from api.regime.detector import policy_for
    from api.regime.models import RegimeSnapshot
    from api.signals.base import SignalOutput
    from api.signals.registry import get_registry

    preds_q = await db.execute(
        select(SignalPrediction).where(SignalPrediction.run_id == run.id)
    )
    signal_outputs: dict[str, list[SignalOutput]] = {}
    for p in preds_q.scalars().all():
        signal_outputs.setdefault(p.signal_name, []).append(
            SignalOutput(ticker=p.ticker, score=p.score, confidence=p.confidence,
                         metadata=p.metadata_ or {})
        )

    regime_id = run.regime_id or "risk_on"
    exposure, tilts = policy_for(regime_id)
    regime = RegimeSnapshot(
        as_of_date=date.today(),
        regime_id=regime_id,
        confidence=run.regime_confidence or 0.5,
        recommended_gross_exposure=exposure,
        factor_tilts=tilts,
    )

    # Identical to the rebalance path: same scorer, same weights source, same
    # watchlist exclusion. Any divergence here would mean publishing a book SIGIL
    # would not itself trade.
    signals = get_registry()
    weights = {s.name: s.default_weight for s in signals.values()}
    scored = score_universe(signal_outputs, weights, regime)

    if watch:
        scored = [s for s in scored if s.ticker not in watch]

    eligible_tickers = [s.ticker for s in scored[:20] if s.eligible]
    sector_lookup_failed = False
    try:
        construction_sectors = await sectors_for_construction(db, eligible_tickers)
    except Exception as e:
        print(f"[agent] Construction sector lookup failed for run {run.id}: {e}")
        construction_sectors = {}
        sector_lookup_failed = True

    return _Constructed(
        book=target_weights(scored, construction_sectors),
        scored=scored,
        regime_id=regime_id,
        regime_confidence=run.regime_confidence or 0.5,
        exposure=exposure,
        sector_lookup_failed=sector_lookup_failed,
    )


async def _build_book(db: AsyncSession) -> dict:
    from api.data.sectors import load_sector_map
    from api.model.portfolio import PortfolioConstraints
    from api.routes.portfolio import _broker
    from api.routes.watchlist import get_watchlist_tickers

    now = datetime.utcnow()
    blocks: list[dict] = []

    run_q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    latest_run = run_q.scalar_one_or_none()

    if latest_run is None:
        # Nothing has ever completed. There is no book to publish, and saying so
        # explicitly is better than an empty target list that reads as "hold cash".
        return {
            "schema_version": SCHEMA_VERSION,
            "generated_at": _iso(now),
            "source": None,
            "actionable": False,
            "blocks": [_block("no_completed_run",
                              "No pipeline run has ever completed; there are no targets.")],
            "regime": None,
            "targets": [],
            "target_cash_weight": None,
            "changes": None,
            "changes_unavailable_reason": "no completed run",
        }

    completed_at = latest_run.finished_at or latest_run.started_at
    age_hours = (now - completed_at).total_seconds() / 3600
    if age_hours > settings.agent_stale_after_hours:
        blocks.append(_block(
            "stale_targets",
            f"Last completed run is {age_hours:.1f}h old, past the "
            f"{settings.agent_stale_after_hours:.0f}h bound.",
        ))

    watch = set(await get_watchlist_tickers(db))
    current = await _construct(db, latest_run, watch)
    scored, book = current.scored, current.book
    regime_id, exposure = current.regime_id, current.exposure

    if current.sector_lookup_failed and settings.enforce_sector_cap:
        # These sectors decide whether the 30% cap binds, so losing them changes the
        # book rather than just the labelling. Publish the uncapped weights but say
        # they are uncapped -- and only while the cap is meant to be enforcing, since
        # with the flag off this lookup returns nothing by design.
        blocks.append(_block(
            "sector_data_unavailable",
            "Sector data could not be read while the sector cap is enforced; "
            "these weights are not sector-capped.",
        ))

    if not book:
        blocks.append(_block(
            "empty_book",
            "Construction produced no positions from the last run.",
        ))

    # Reported separately from the sectors construction saw: with
    # enforce_sector_cap off every candidate is deliberately Unknown to the cap,
    # but the real sector is still the useful thing to publish. Purely a label
    # here, so a failure costs the label and never the book.
    real_sectors: dict[str, str] = {}
    if book:
        try:
            real_sectors = await load_sector_map(db, list(book.keys()))
        except Exception as e:
            print(f"[agent] Sector labels unavailable: {e}")

    rank_of = {s.ticker: i + 1 for i, s in enumerate(scored)}
    score_of = {s.ticker: s for s in scored}

    if _broker.is_demo:
        blocks.append(_block(
            "demo_mode",
            "SIGIL is running without broker credentials; this is not a live book.",
        ))

    # Fails closed inside the broker: an unreachable clock reports not-open, which
    # surfaces here as a block rather than as silent permission to trade.
    if not await _broker.is_market_open():
        blocks.append(_block(
            "market_closed",
            "The market is closed, or the market clock could not be read.",
        ))

    targets = []
    for ticker, weight in sorted(book.items(), key=lambda kv: -kv[1]):
        s = score_of.get(ticker)
        targets.append({
            "ticker": ticker,
            "rank": rank_of.get(ticker),
            "target_weight": round(weight, 6),
            "score": round(s.final_score, 6) if s else None,
            "confidence": round(s.confidence, 4) if s else None,
            "sector": real_sectors.get(ticker),
        })

    # Diffing costs a second scoring pass over an older run's predictions. It is
    # behind the same 45s cache as the book, and a failure here must not cost the
    # consumer its targets -- so it degrades to a stated reason, never an error.
    changes: dict | None = None
    no_diff_reason: str | None = None
    prev_run, fell_back = await _pick_comparison_run(db, latest_run)
    if prev_run is None:
        no_diff_reason = "no earlier completed run to compare against"
    else:
        try:
            previous = await _construct(db, prev_run, watch)
            changes = _diff_books(current, previous, prev_run, now, fell_back)
        except Exception as e:
            print(f"[agent] Diff against run {prev_run.id} failed: {e}")
            no_diff_reason = f"comparison against run {prev_run.id} failed"

    constraints = PortfolioConstraints()
    invested = sum(t["target_weight"] for t in targets)

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _iso(now),
        "source": {
            "run_id": latest_run.id,
            "completed_at": _iso(completed_at),
            "age_hours": round(age_hours, 2),
            "stale_after_hours": settings.agent_stale_after_hours,
            "universe_size": latest_run.universe_size,
        },
        "actionable": not blocks,
        "blocks": blocks,
        "regime": {
            "id": regime_id,
            "confidence": round(latest_run.regime_confidence or 0.5, 4),
            "gross_exposure_target": round(exposure, 4),
        },
        # Weights are of the invested book and sum to ~1.0. Multiply by
        # gross_exposure_target for the share of the account to actually hold;
        # target_cash_weight is the remainder.
        "targets": targets,
        "target_cash_weight": round(max(0.0, 1.0 - invested * exposure), 6),
        # What moved since the comparison run. Null when there is nothing to
        # compare against or the comparison failed, with the reason alongside --
        # an absent diff and a diff showing no change are different facts.
        "changes": changes,
        "changes_unavailable_reason": no_diff_reason,
        "constraints": {
            "max_positions": constraints.max_positions,
            "max_position_pct": constraints.max_position_pct,
            "min_position_pct": constraints.min_position_pct,
            "max_sector_pct": constraints.max_sector_pct,
            "sector_cap_enforced": settings.enforce_sector_cap,
        },
    }


# Weight moves below this are noise from rescoring, not decisions. Reporting them
# would bury the handful of real changes in twenty rows of +0.0001.
MIN_WEIGHT_DELTA = 0.0005


async def _pick_comparison_run(db: AsyncSession,
                               current: PipelineRun) -> tuple[PipelineRun | None, bool]:
    """The run to diff against: newest completed one meaningfully older than this.

    The consumer is a daily brief, so "what changed" means since yesterday. At a
    6h cadence the immediately previous run is four runs ago by that standard and
    would report almost nothing. Falls back to the immediately previous run when
    history is too short, and says which it did.
    """
    current_at = current.finished_at or current.started_at
    cutoff = current_at - timedelta(hours=settings.agent_diff_lookback_hours)

    q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .where(PipelineRun.id != current.id)
        .where(PipelineRun.started_at <= cutoff)
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    run = q.scalar_one_or_none()
    if run is not None:
        return run, False

    q = await db.execute(
        select(PipelineRun)
        .where(PipelineRun.status == "completed")
        .where(PipelineRun.id != current.id)
        .where(PipelineRun.started_at < current.started_at)
        .order_by(PipelineRun.started_at.desc())
        .limit(1)
    )
    return q.scalar_one_or_none(), True


def _diff_books(current: _Constructed, previous: _Constructed,
                prev_run: PipelineRun, now: datetime,
                fell_back: bool) -> dict:
    """What changed between two books.

    Turnover is one-way: half the sum of absolute weight changes, which is the
    fraction of the book that would have to trade to get from one to the other.
    It is the single number worth reading first.
    """
    cur_w, prev_w = current.book, previous.book
    cur_rank = {s.ticker: i + 1 for i, s in enumerate(current.scored)}
    prev_rank = {s.ticker: i + 1 for i, s in enumerate(previous.scored)}
    cur_score = {s.ticker: s.final_score for s in current.scored}
    prev_score = {s.ticker: s.final_score for s in previous.scored}

    added, dropped, resized = [], [], []
    held = 0

    for ticker in sorted(set(cur_w) | set(prev_w)):
        now_w, was_w = cur_w.get(ticker), prev_w.get(ticker)
        if was_w is None:
            added.append({
                "ticker": ticker,
                "target_weight": round(now_w, 6),
                "rank": cur_rank.get(ticker),
                "score": round(cur_score.get(ticker, 0.0), 6),
                "previous_rank": prev_rank.get(ticker),
            })
        elif now_w is None:
            dropped.append({
                "ticker": ticker,
                "previous_target_weight": round(was_w, 6),
                "previous_rank": prev_rank.get(ticker),
                # Still scored, just no longer held -- the rank it fell to says
                # whether this was a near-miss or a collapse.
                "rank": cur_rank.get(ticker),
                "score": round(cur_score[ticker], 6) if ticker in cur_score else None,
            })
        elif abs(now_w - was_w) >= MIN_WEIGHT_DELTA:
            resized.append({
                "ticker": ticker,
                "target_weight": round(now_w, 6),
                "previous_target_weight": round(was_w, 6),
                "weight_delta": round(now_w - was_w, 6),
                "rank": cur_rank.get(ticker),
                "previous_rank": prev_rank.get(ticker),
                "score_delta": round(
                    cur_score.get(ticker, 0.0) - prev_score.get(ticker, 0.0), 6
                ),
            })
        else:
            held += 1

    resized.sort(key=lambda r: -abs(r["weight_delta"]))
    added.sort(key=lambda r: -r["target_weight"])
    dropped.sort(key=lambda r: -r["previous_target_weight"])

    turnover = sum(
        abs(cur_w.get(t, 0.0) - prev_w.get(t, 0.0))
        for t in set(cur_w) | set(prev_w)
    ) / 2

    prev_at = prev_run.finished_at or prev_run.started_at
    regime_changed = current.regime_id != previous.regime_id
    return {
        "compared_to": {
            "run_id": prev_run.id,
            "completed_at": _iso(prev_at),
            "hours_before_current": round(
                (now - prev_at).total_seconds() / 3600, 2
            ),
            # True when history was too short to reach back the configured
            # window, so the diff covers less time than the consumer expects.
            "fell_back_to_previous_run": fell_back,
            "lookback_hours": settings.agent_diff_lookback_hours,
        },
        "turnover": round(turnover, 6),
        "added": added,
        "dropped": dropped,
        "resized": resized,
        "held_unchanged": held,
        "regime_change": {
            "from": previous.regime_id,
            "to": current.regime_id,
            "from_confidence": round(previous.regime_confidence, 4),
            "to_confidence": round(current.regime_confidence, 4),
        } if regime_changed else None,
    }


def _block(code: str, detail: str) -> dict:
    return {"code": code, "detail": detail}


def _iso(dt: datetime) -> str:
    """UTC, with the Z the consumer needs to read it as UTC rather than local."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


REVIEW_CACHE_KEY = "agent_review"
# The review scans every evaluation, execution and equity snapshot on record,
# which is markedly heavier than the book. It is meant to be read once a week, so
# a long TTL costs nothing in freshness and stops a consumer that polls by mistake
# from re-running those scans on every call.
REVIEW_CACHE_TTL = 300

DEFAULT_REVIEW_DAYS = 7
MAX_REVIEW_DAYS = 365


@router.get("/review")
async def get_review(days: int = DEFAULT_REVIEW_DAYS,
                     db: AsyncSession = Depends(get_db)):
    """How the book has actually been working out, over a trailing window.

    The weekly counterpart to /book: /book is what SIGIL intends to hold now,
    this is whether those intentions have been paying. Everything here comes from
    records the system already keeps -- equity snapshots, signal evaluations,
    order executions, closed trades -- so a reviewer gets the same numbers the
    dashboard shows without being handed the dashboard password, which would also
    grant rebalance, close-all and reset-account-history.

    Deliberately does NOT reconcile pending fills, which is what
    /api/portfolio/execution-quality does before reporting. That reconcile writes
    rows and calls the broker, and the whole promise of the agent prefix is that a
    leaked token reaches nothing that changes state. The cost is that fills from
    the last few minutes may not be counted yet -- irrelevant at a weekly cadence,
    and stated in the payload as `execution.excludes_unreconciled` so a reader
    never mistakes it for a complete picture.
    """
    days = max(1, min(int(days), MAX_REVIEW_DAYS))
    key = f"{REVIEW_CACHE_KEY}:{days}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    payload = await _build_review(db, days)
    cache.set(key, payload, ttl=REVIEW_CACHE_TTL)
    return payload


async def _build_review(db: AsyncSession, days: int) -> dict:
    from datetime import timedelta

    from api.db.models import EquitySnapshot, RegimeHistory, Trade
    from api.model.risk_metrics import compute, daily_closes, risk_free_annual
    from api.tracker.evaluator import get_signal_stats
    from api.tracker.execution import execution_quality

    now = datetime.utcnow()
    since = now - timedelta(days=days)
    notes: list[str] = []

    all_snaps = (await db.execute(
        select(EquitySnapshot).order_by(EquitySnapshot.taken_at.asc())
    )).scalars().all()
    window_snaps = [s for s in all_snaps if s.taken_at >= since]

    # Drawdown is reported separately from the window return. A week that looks
    # flat end-to-end can still be a week that gave back a large intra-window
    # gain, and the equity record is hourly, so that is visible here even though
    # a start/end pair hides it.
    performance = None
    if window_snaps:
        start_eq = window_snaps[0].equity
        end_eq = window_snaps[-1].equity
        peak = start_eq
        max_dd = 0.0
        for s in window_snaps:
            peak = max(peak, s.equity)
            if peak > 0:
                max_dd = min(max_dd, (s.equity - peak) / peak)
        inception_eq = all_snaps[0].equity
        performance = {
            "window_start_equity": round(start_eq, 2),
            "window_end_equity": round(end_eq, 2),
            "window_return": round((end_eq / start_eq) - 1, 6) if start_eq else None,
            "window_max_drawdown": round(max_dd, 6),
            "since_inception_return": (
                round((end_eq / inception_eq) - 1, 6) if inception_eq else None
            ),
            "inception_at": _iso(all_snaps[0].taken_at),
            "snapshots_in_window": len(window_snaps),
            "current_positions": window_snaps[-1].positions_count,
            "current_cash": (
                round(window_snaps[-1].cash, 2)
                if window_snaps[-1].cash is not None else None
            ),
        }
    else:
        notes.append(
            f"No equity snapshots in the last {days}d; performance is unavailable "
            "for this window."
        )

    # Sharpe and Sortino intentionally span the whole record rather than the
    # window: a 7d window is far too few daily returns to annualise, and compute()
    # returns nulls rather than a confident wrong number.
    try:
        rf_annual, rf_source = await risk_free_annual()
        risk = compute(daily_closes(all_snaps), rf_annual, rf_source)
        if isinstance(risk, dict):
            risk = {**risk, "scope": "all_time"}
    except Exception as e:
        print(f"[agent] Risk metrics unavailable: {e}")
        risk = None
        notes.append("Risk metrics could not be computed.")

    # Hit rates are all-time by construction -- an evaluation only exists once its
    # horizon has elapsed, so a 7d window would mostly measure which predictions
    # happened to mature this week rather than how the signals are doing. Labelled
    # scope so a reader does not report it as a weekly number.
    try:
        signal_stats = await get_signal_stats(db)
    except Exception as e:
        print(f"[agent] Signal stats unavailable: {e}")
        signal_stats = None
        notes.append("Signal evaluation stats could not be read.")

    try:
        execution = await execution_quality(db, days=days)
        if isinstance(execution, dict):
            execution = {**execution, "excludes_unreconciled": True}
    except Exception as e:
        print(f"[agent] Execution quality unavailable: {e}")
        execution = None
        notes.append("Execution quality could not be computed.")

    closed = (await db.execute(
        select(Trade)
        .where(Trade.closed_at.is_not(None))
        .where(Trade.closed_at >= since)
        .order_by(Trade.closed_at.desc())
    )).scalars().all()
    closed_trades = [{
        "ticker": t.ticker,
        "opened_at": _iso(t.opened_at) if t.opened_at else None,
        "closed_at": _iso(t.closed_at) if t.closed_at else None,
        "holding_days": (
            round((t.closed_at - t.opened_at).total_seconds() / 86400, 1)
            if t.opened_at and t.closed_at else None
        ),
        "realized_pnl": round(t.realized_pnl, 2) if t.realized_pnl is not None else None,
        "return_pct": (
            round((t.exit_price / t.entry_price) - 1, 6)
            if t.entry_price and t.exit_price else None
        ),
        "regime_at_entry": t.regime_at_entry,
        "signal_drivers": t.signal_drivers,
    } for t in closed]

    wins = [t for t in closed_trades if (t["realized_pnl"] or 0) > 0]
    realized = [t["realized_pnl"] for t in closed_trades if t["realized_pnl"] is not None]

    regimes = (await db.execute(
        select(RegimeHistory)
        .where(RegimeHistory.as_of_date >= since.date())
        .order_by(RegimeHistory.as_of_date.asc())
    )).scalars().all()
    regime_history = [{
        "date": r.as_of_date.isoformat(),
        "regime_id": r.regime_id,
        "confidence": round(r.confidence, 4) if r.confidence is not None else None,
        "spy_20d_return": r.spy_20d_return,
        "vix_level": r.vix_level,
        "breadth_state": r.breadth_state,
    } for r in regimes]
    distinct_regimes = sorted({r["regime_id"] for r in regime_history})

    runs = (await db.execute(
        select(PipelineRun)
        .where(PipelineRun.started_at >= since)
        .order_by(PipelineRun.started_at.desc())
    )).scalars().all()
    completed_runs = [r for r in runs if r.status == "completed"]

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _iso(now),
        "window": {
            "days": days,
            "since": _iso(since),
            "until": _iso(now),
        },
        "performance": performance,
        "risk": risk,
        # All-time, not windowed -- see the comment above the call.
        "signal_stats": {"scope": "all_time", "by_signal": signal_stats},
        "execution": execution,
        "trades": {
            "closed_in_window": len(closed_trades),
            "win_rate": round(len(wins) / len(closed_trades), 4) if closed_trades else None,
            "total_realized_pnl": round(sum(realized), 2) if realized else None,
            "detail": closed_trades,
        },
        "regime": {
            "changed_during_window": len(distinct_regimes) > 1,
            "distinct_regimes": distinct_regimes,
            "history": regime_history,
        },
        # Runs expected vs completed is the cheapest missed-cycle detector there
        # is: the book only says how old the last run was, not how many never
        # happened.
        "pipeline": {
            "runs_started": len(runs),
            "runs_completed": len(completed_runs),
            "last_completed_at": (
                _iso(completed_runs[0].finished_at or completed_runs[0].started_at)
                if completed_runs else None
            ),
            "expected_runs": round(days * 24 / max(settings.pipeline_interval_hours, 0.1)),
        },
        "notes": notes,
    }
