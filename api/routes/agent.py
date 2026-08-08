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

`actionable` and `blocks`. SIGIL declines to trade under conditions a screenshot
cannot show -- a pipeline run that never completed, targets several days stale,
a closed market. An executor reading a picture cannot tell "here are today's
targets" from "this is three days old and SIGIL itself would refuse". Those
reasons are stated here so the consumer inherits the same guards rather than
routing around them.
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api import cache
from api.config.settings import settings
from api.db import get_db
from api.db.models import PipelineRun, SignalPrediction

router = APIRouter(prefix="/api/agent", tags=["agent"])

SCHEMA_VERSION = 1

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


async def _build_book(db: AsyncSession) -> dict:
    from api.data.sectors import load_sector_map, sectors_for_construction
    from api.model.portfolio import PortfolioConstraints, target_weights
    from api.model.scorer import score_universe
    from api.regime.detector import policy_for
    from api.regime.models import RegimeSnapshot
    from api.routes.portfolio import _broker
    from api.routes.watchlist import get_watchlist_tickers
    from api.signals.base import SignalOutput
    from api.signals.registry import get_registry

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
        }

    completed_at = latest_run.finished_at or latest_run.started_at
    age_hours = (now - completed_at).total_seconds() / 3600
    if age_hours > settings.agent_stale_after_hours:
        blocks.append(_block(
            "stale_targets",
            f"Last completed run is {age_hours:.1f}h old, past the "
            f"{settings.agent_stale_after_hours:.0f}h bound.",
        ))

    preds_q = await db.execute(
        select(SignalPrediction).where(SignalPrediction.run_id == latest_run.id)
    )
    preds = preds_q.scalars().all()

    signal_outputs: dict[str, list[SignalOutput]] = {}
    for p in preds:
        signal_outputs.setdefault(p.signal_name, []).append(
            SignalOutput(ticker=p.ticker, score=p.score, confidence=p.confidence,
                         metadata=p.metadata_ or {})
        )

    regime_id = latest_run.regime_id or "risk_on"
    exposure, tilts = policy_for(regime_id)
    regime = RegimeSnapshot(
        as_of_date=date.today(),
        regime_id=regime_id,
        confidence=latest_run.regime_confidence or 0.5,
        recommended_gross_exposure=exposure,
        factor_tilts=tilts,
    )

    # Identical to the rebalance path: same scorer, same weights source, same
    # watchlist exclusion. Any divergence here would mean publishing a book SIGIL
    # would not itself trade.
    signals = get_registry()
    weights = {s.name: s.default_weight for s in signals.values()}
    scored = score_universe(signal_outputs, weights, regime)

    watch = set(await get_watchlist_tickers(db))
    if watch:
        scored = [s for s in scored if s.ticker not in watch]

    eligible_tickers = [s.ticker for s in scored[:20] if s.eligible]
    try:
        construction_sectors = await sectors_for_construction(db, eligible_tickers)
    except Exception as e:
        # These sectors decide whether the 30% cap binds, so losing them changes the
        # book rather than just the labelling. Publish the uncapped weights but say
        # they are uncapped -- and only while the cap is meant to be enforcing, since
        # with the flag off this lookup returns nothing by design.
        print(f"[agent] Construction sector lookup failed: {e}")
        construction_sectors = {}
        if settings.enforce_sector_cap:
            blocks.append(_block(
                "sector_data_unavailable",
                "Sector data could not be read while the sector cap is enforced; "
                "these weights are not sector-capped.",
            ))

    book = target_weights(scored, construction_sectors)

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
        "constraints": {
            "max_positions": constraints.max_positions,
            "max_position_pct": constraints.max_position_pct,
            "min_position_pct": constraints.min_position_pct,
            "max_sector_pct": constraints.max_sector_pct,
            "sector_cap_enforced": settings.enforce_sector_cap,
        },
    }


def _block(code: str, detail: str) -> dict:
    return {"code": code, "detail": detail}


def _iso(dt: datetime) -> str:
    """UTC, with the Z the consumer needs to read it as UTC rather than local."""
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
