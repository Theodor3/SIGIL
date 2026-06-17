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
        from api.data.registry import SourceStatus, update_source_status

        # Phase 1: Fetch fundamentals
        yahoo = YahooProvider(demo_mode=settings.demo_mode)
        universe = SEED_UNIVERSE.copy()
        fundamentals = await yahoo.fetch(universe)
        update_source_status("yahoo_fundamentals", SourceStatus.ACTIVE, fetch_count=len(fundamentals))
        update_source_status("universe_screener", SourceStatus.ACTIVE, fetch_count=len(universe))

        # Phase 2: Screen to growth bucket
        bucket = screen_universe(fundamentals)
        if not bucket:
            bucket = list(fundamentals.keys())[:75]

        # Phase 3: Fetch additional data sources in parallel
        earnings_calendar: dict[str, date] = {}
        earnings_history: dict[str, list] = {}
        market_data: dict[str, dict] = {}
        macro: dict = {}
        nowcast: dict[str, dict] = {}
        benchmarks: dict = {}

        # Finnhub — earnings data for PEAD signal
        if settings.finnhub_api_key:
            try:
                from api.data.finnhub import FinnhubProvider
                finnhub = FinnhubProvider()
                fh_data = await finnhub.fetch(bucket)
                earnings_calendar = fh_data.get("calendar", {})
                earnings_history = fh_data.get("history", {})
                update_source_status("finnhub_earnings", SourceStatus.ACTIVE,
                                     fetch_count=len(earnings_calendar) + len(earnings_history))
                print(f"[pipeline] Finnhub: {len(earnings_calendar)} calendar, {len(earnings_history)} history")
            except Exception as e:
                print(f"[pipeline] Finnhub failed: {e}")
                update_source_status("finnhub_earnings", SourceStatus.ERROR, error=str(e))

        # Polygon — market data + benchmarks for regime
        if settings.polygon_api_key:
            try:
                from api.data.polygon import PolygonProvider
                polygon = PolygonProvider()
                market_data = await polygon.fetch(bucket)
                benchmarks = await polygon.fetch_benchmarks()
                update_source_status("polygon_market", SourceStatus.ACTIVE,
                                     fetch_count=len(market_data))
                print(f"[pipeline] Polygon: {len(market_data)} tickers, {len(benchmarks)} benchmark fields")
            except Exception as e:
                print(f"[pipeline] Polygon failed: {e}")
                update_source_status("polygon_market", SourceStatus.ERROR, error=str(e))

        # FRED — macro indicators for regime detection
        if settings.fred_api_key:
            try:
                from api.data.fred import FredProvider
                fred = FredProvider()
                macro = await fred.fetch()
                update_source_status("fred_macro", SourceStatus.ACTIVE, fetch_count=len(macro))
                print(f"[pipeline] FRED: {len(macro)} macro indicators")
            except Exception as e:
                print(f"[pipeline] FRED failed: {e}")
                update_source_status("fred_macro", SourceStatus.ERROR, error=str(e))

        # Wikipedia — pageview alt data
        try:
            from api.data.wikipedia import WikipediaProvider
            wiki = WikipediaProvider()
            wiki_data = await wiki.fetch(bucket)
            nowcast.update(wiki_data)
            update_source_status("wikipedia_pageviews", SourceStatus.ACTIVE, fetch_count=len(wiki_data))
            print(f"[pipeline] Wikipedia: {len(wiki_data)} tickers with pageview data")
        except Exception as e:
            print(f"[pipeline] Wikipedia failed: {e}")
            update_source_status("wikipedia_pageviews", SourceStatus.ERROR, error=str(e))

        # GDELT — news sentiment (merge with nowcast, preferring wiki for direct + gdelt for proxy)
        try:
            from api.data.gdelt import GdeltProvider
            gdelt = GdeltProvider()
            gdelt_data = await gdelt.fetch(bucket)
            for ticker, gd in gdelt_data.items():
                if ticker in nowcast:
                    # Merge: upgrade to hybrid if we have both wiki and gdelt
                    nowcast[ticker]["source_mix"] = "hybrid"
                    nowcast[ticker]["proxy_source_count"] = 1
                    nowcast[ticker]["deviation"] = gd.get("deviation", 0)
                    nowcast[ticker]["news_tone_shift"] = gd.get("tone_shift", 0)
                else:
                    nowcast[ticker] = gd
            update_source_status("gdelt_news", SourceStatus.ACTIVE, fetch_count=len(gdelt_data))
            print(f"[pipeline] GDELT: {len(gdelt_data)} tickers with news data")
        except Exception as e:
            print(f"[pipeline] GDELT failed: {e}")
            update_source_status("gdelt_news", SourceStatus.ERROR, error=str(e))

        # Build market context for regime detection (merge benchmarks + FRED macro)
        market_context = {**benchmarks, **macro}

        # Phase 4: Build pipeline context
        ctx = PipelineContext(
            as_of_date=as_of,
            universe=bucket,
            fundamentals={t: fundamentals[t] for t in bucket if t in fundamentals},
            market_data=market_data,
            earnings_calendar=earnings_calendar,
            earnings_history=earnings_history,
            nowcast=nowcast,
            macro=macro,
            benchmarks=benchmarks,
        )

        # Phase 5: Detect regime with real market data
        regime = await detect_regime(market_context, as_of)
        print(f"[pipeline] Regime: {regime.regime_id} ({regime.confidence:.0%} confidence)")

        # Phase 6: Run all signals
        registry = get_registry()
        signal_outputs = {}
        for sig_name, signal in registry.items():
            try:
                outputs = await signal.compute(ctx)
                signal_outputs[sig_name] = outputs
                active_count = sum(1 for o in outputs if o.score > 0)
                print(f"[pipeline] Signal {sig_name}: {active_count}/{len(outputs)} active scores")
            except Exception as e:
                print(f"Signal {sig_name} failed: {e}")

        # Phase 7: Store predictions
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

        # Phase 8: Score universe
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
