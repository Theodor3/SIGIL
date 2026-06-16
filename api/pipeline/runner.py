"""Pipeline runner — orchestrates data fetch → signals → scoring → storage."""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config.settings import settings
from api.data.context import PipelineContext
from api.data.universe import SEED_UNIVERSE, screen_universe
from api.data.yahoo import YahooProvider
from api.db.models import PipelineRun, SignalPrediction
from api.model.scorer import score_universe
from api.regime.detector import detect_regime
from api.regime.models import RegimeSnapshot
from api.signals.registry import get_registry


async def run_pipeline(db: AsyncSession) -> dict:
    """Execute a full pipeline run: fetch → score → store."""
    run_id = str(uuid.uuid4())
    started_at = datetime.utcnow()
    as_of = date.today()

    # Record the run
    run = PipelineRun(
        id=run_id,
        started_at=started_at,
        status="running",
    )
    db.add(run)
    await db.flush()

    try:
        # Phase 1: Fetch fundamentals
        yahoo = YahooProvider(demo_mode=settings.demo_mode)
        universe = SEED_UNIVERSE.copy()
        fundamentals = await yahoo.fetch(universe)

        # Phase 2: Screen to growth bucket
        bucket = screen_universe(fundamentals)
        if not bucket:
            bucket = list(fundamentals.keys())[:75]

        # Phase 3: Build pipeline context
        ctx = PipelineContext(
            as_of_date=as_of,
            universe=bucket,
            fundamentals={t: fundamentals[t] for t in bucket if t in fundamentals},
        )

        # Phase 4: Detect regime (placeholder for now)
        regime = await detect_regime({}, as_of)

        # Phase 5: Run all signals
        registry = get_registry()
        signal_outputs = {}
        for sig_name, signal in registry.items():
            try:
                outputs = await signal.compute(ctx)
                signal_outputs[sig_name] = outputs
            except Exception as e:
                print(f"Signal {sig_name} failed: {e}")

        # Phase 6: Store predictions
        for sig_name, outputs in signal_outputs.items():
            signal = registry[sig_name]
            for out in outputs:
                pred = SignalPrediction(
                    run_id=run_id,
                    run_date=as_of,
                    signal_name=sig_name,
                    signal_version=signal.version,
                    ticker=out.ticker,
                    score=out.score,
                    confidence=out.confidence,
                    metadata_=out.metadata,
                )
                db.add(pred)

        # Phase 7: Score universe
        weights = {}
        for sig_name, signal in registry.items():
            weights[sig_name] = signal.default_weight

        scored = score_universe(signal_outputs, weights, regime)

        # Update run record
        run.finished_at = datetime.utcnow()
        run.status = "completed"
        run.regime_id = regime.regime_id
        run.regime_confidence = regime.confidence
        run.universe_size = len(bucket)
        await db.commit()

        top_ideas = [
            {
                "rank": i + 1,
                "ticker": s.ticker,
                "final_score": s.final_score,
                "confidence": s.confidence,
                "signal_scores": s.signal_scores,
                "eligible": s.eligible,
                "sector": fundamentals.get(s.ticker, {}).get("sector", ""),
                "market_cap": fundamentals.get(s.ticker, {}).get("market_cap"),
            }
            for i, s in enumerate(scored[:20])
        ]

        return {
            "run_id": run_id,
            "status": "completed",
            "universe_size": len(bucket),
            "signals_run": list(signal_outputs.keys()),
            "regime": regime.regime_id,
            "top_ideas": top_ideas,
            "duration_seconds": (datetime.utcnow() - started_at).total_seconds(),
        }

    except Exception as e:
        run.finished_at = datetime.utcnow()
        run.status = "failed"
        run.error_message = str(e)
        await db.commit()
        raise
