"""Pipeline runner — orchestrates data fetch → signals → scoring → storage."""
from __future__ import annotations

import asyncio
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
from api.signals.registry import get_registry


async def _fetch_finnhub(bucket: list[str]) -> dict:
    if not settings.finnhub_api_key:
        return {"calendar": {}, "history": {}}
    from api.data.finnhub import FinnhubProvider
    fh = FinnhubProvider()
    return await fh.fetch(bucket)


async def _fetch_benchmarks() -> dict:
    if not settings.polygon_api_key:
        return {}
    from api.data.polygon import PolygonProvider
    pg = PolygonProvider()
    return await pg.fetch_benchmarks()


async def _fetch_fred() -> dict:
    if not settings.fred_api_key:
        return {}
    from api.data.fred import FredProvider
    return await FredProvider().fetch()


async def _fetch_wikipedia(bucket: list[str]) -> dict:
    from api.data.wikipedia import WikipediaProvider
    return await WikipediaProvider().fetch(bucket)


async def _fetch_gdelt(bucket: list[str]) -> dict:
    from api.data.gdelt import GdeltProvider
    return await GdeltProvider().fetch(bucket)


async def _fetch_insider(bucket: list[str]) -> dict:
    if not settings.finnhub_api_key:
        return {}
    from api.data.finnhub import FinnhubProvider
    return await FinnhubProvider().fetch_insider_transactions(bucket)


async def _fetch_analyst(bucket: list[str]) -> dict:
    if not settings.finnhub_api_key:
        return {}
    from api.data.finnhub import FinnhubProvider
    return await FinnhubProvider().fetch_analyst_estimates(bucket)


async def _fetch_yahoo_prices(yahoo: YahooProvider, bucket: list[str]) -> dict:
    return await yahoo.fetch_prices(bucket)


async def run_pipeline(db: AsyncSession) -> dict:
    """Execute a full pipeline run: fetch → score → store."""
    run_id = str(uuid.uuid4())
    started_at = datetime.utcnow()
    as_of = date.today()

    run = PipelineRun(id=run_id, started_at=started_at, status="running")
    db.add(run)
    await db.flush()

    try:
        from api.data.registry import SourceStatus, update_source_status

        # Phase 1: Fetch fundamentals (must complete before screening)
        yahoo = YahooProvider(demo_mode=settings.demo_mode)
        universe = SEED_UNIVERSE.copy()
        fundamentals = await yahoo.fetch(universe)
        update_source_status("yahoo_fundamentals", SourceStatus.ACTIVE, fetch_count=len(fundamentals))
        update_source_status("universe_screener", SourceStatus.ACTIVE, fetch_count=len(universe))

        # Phase 2: Screen to growth bucket
        bucket = screen_universe(fundamentals)
        if not bucket:
            bucket = list(fundamentals.keys())[:75]
        print(f"[pipeline] Universe: {len(bucket)} tickers after screening")

        # Phase 3: Fetch ALL other data sources IN PARALLEL
        t0 = datetime.utcnow()
        results = await asyncio.gather(
            _fetch_yahoo_prices(yahoo, bucket),
            _fetch_finnhub(bucket),
            _fetch_benchmarks(),
            _fetch_fred(),
            _fetch_wikipedia(bucket),
            _fetch_gdelt(bucket),
            _fetch_insider(bucket),
            _fetch_analyst(bucket),
            return_exceptions=True,
        )
        fetch_time = (datetime.utcnow() - t0).total_seconds()
        print(f"[pipeline] Parallel fetch completed in {fetch_time:.1f}s")

        # Unpack results with graceful fallbacks
        market_data = results[0] if not isinstance(results[0], Exception) else {}
        fh_data = results[1] if not isinstance(results[1], Exception) else {"calendar": {}, "history": {}}
        benchmarks = results[2] if not isinstance(results[2], Exception) else {}
        macro = results[3] if not isinstance(results[3], Exception) else {}
        wiki_data = results[4] if not isinstance(results[4], Exception) else {}
        gdelt_data = results[5] if not isinstance(results[5], Exception) else {}
        insider_data = results[6] if not isinstance(results[6], Exception) else {}
        analyst_data = results[7] if not isinstance(results[7], Exception) else {}

        # Log errors from any failed providers
        provider_names = ["yahoo_prices", "finnhub", "polygon_benchmarks", "fred", "wikipedia", "gdelt", "insider", "analyst"]
        for i, name in enumerate(provider_names):
            if isinstance(results[i], Exception):
                print(f"[pipeline] {name} failed: {results[i]}")

        # Update source statuses
        if not isinstance(results[0], Exception):
            update_source_status("polygon_market", SourceStatus.ACTIVE, fetch_count=len(market_data))
            print(f"[pipeline] Yahoo prices: {len(market_data)} tickers")
        else:
            update_source_status("polygon_market", SourceStatus.ERROR, error=str(results[0]))

        earnings_calendar = fh_data.get("calendar", {})
        earnings_history = fh_data.get("history", {})
        if not isinstance(results[1], Exception):
            update_source_status("finnhub_earnings", SourceStatus.ACTIVE,
                                 fetch_count=len(earnings_calendar) + len(earnings_history))
            print(f"[pipeline] Finnhub: {len(earnings_calendar)} calendar, {len(earnings_history)} history")
        else:
            update_source_status("finnhub_earnings", SourceStatus.ERROR, error=str(results[1]))

        if not isinstance(results[2], Exception):
            print(f"[pipeline] Polygon benchmarks: {len(benchmarks)} fields")

        if not isinstance(results[3], Exception):
            update_source_status("fred_macro", SourceStatus.ACTIVE, fetch_count=len(macro))
            print(f"[pipeline] FRED: {len(macro)} macro indicators")
        else:
            update_source_status("fred_macro", SourceStatus.ERROR, error=str(results[3]))

        # Merge Wikipedia + GDELT into nowcast
        nowcast: dict[str, dict] = {}
        if not isinstance(results[4], Exception):
            nowcast.update(wiki_data)
            update_source_status("wikipedia_pageviews", SourceStatus.ACTIVE, fetch_count=len(wiki_data))
            print(f"[pipeline] Wikipedia: {len(wiki_data)} tickers")
        else:
            update_source_status("wikipedia_pageviews", SourceStatus.ERROR, error=str(results[4]))

        if not isinstance(results[5], Exception):
            for ticker, gd in gdelt_data.items():
                if ticker in nowcast:
                    nowcast[ticker]["source_mix"] = "hybrid"
                    nowcast[ticker]["proxy_source_count"] = 1
                    nowcast[ticker]["deviation"] = gd.get("deviation", 0)
                    nowcast[ticker]["news_tone_shift"] = gd.get("tone_shift", 0)
                else:
                    nowcast[ticker] = gd
            update_source_status("gdelt_news", SourceStatus.ACTIVE, fetch_count=len(gdelt_data))
            print(f"[pipeline] GDELT: {len(gdelt_data)} tickers")
        else:
            update_source_status("gdelt_news", SourceStatus.ERROR, error=str(results[5]))

        if not isinstance(results[6], Exception):
            print(f"[pipeline] Insider transactions: {len(insider_data)} tickers")
        if not isinstance(results[7], Exception):
            print(f"[pipeline] Analyst estimates: {len(analyst_data)} tickers")

        # Build market context for regime detection
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
            insider_transactions=insider_data,
            analyst_estimates=analyst_data,
            macro=macro,
            benchmarks=benchmarks,
        )

        # Phase 5: Detect regime
        regime = await detect_regime(market_context, as_of)
        print(f"[pipeline] Regime: {regime.regime_id} ({regime.confidence:.0%} confidence)")

        # Store regime snapshot in history (upsert by as_of_date)
        from api.db.models import RegimeHistory
        existing_rh = await db.execute(
            select(RegimeHistory).where(RegimeHistory.as_of_date == as_of)
        )
        rh_row = existing_rh.scalar_one_or_none()
        rh_meta = {
            "vol_state": regime.vol_state,
            "spy_20d": regime.metadata.get("spy_20d"),
            "qqq_20d": regime.metadata.get("qqq_20d"),
            "vix": regime.metadata.get("vix"),
            "exposure": regime.recommended_gross_exposure,
            "factor_tilts": regime.factor_tilts,
        }
        if rh_row:
            rh_row.regime_id = regime.regime_id
            rh_row.confidence = regime.confidence
            rh_row.spy_20d_return = regime.metadata.get("spy_20d")
            rh_row.vix_level = regime.metadata.get("vix")
            rh_row.breadth_state = regime.breadth_state
            rh_row.metadata_ = rh_meta
        else:
            db.add(RegimeHistory(
                as_of_date=as_of,
                regime_id=regime.regime_id,
                confidence=regime.confidence,
                spy_20d_return=regime.metadata.get("spy_20d"),
                vix_level=regime.metadata.get("vix"),
                breadth_state=regime.breadth_state,
                metadata_=rh_meta,
            ))

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
        weights = {sig_name: signal.default_weight for sig_name, signal in registry.items()}
        scored = score_universe(signal_outputs, weights, regime)

        # Finalize run
        run.finished_at = datetime.utcnow()
        run.status = "completed"
        run.regime_id = regime.regime_id
        run.regime_confidence = regime.confidence
        run.universe_size = len(bucket)
        await db.commit()

        # Pre-warm company info cache for top tickers (avoids cold Research page)
        from api import cache as app_cache
        for s in scored[:30]:
            fund = fundamentals.get(s.ticker, {})
            md = market_data.get(s.ticker, {})
            if fund:
                app_cache.set(f"company:{s.ticker}", {
                    "name": s.ticker,
                    "description": fund.get("description", "")[:600],
                    "sector": fund.get("sector", ""),
                    "industry": fund.get("industry", ""),
                    "market_cap": fund.get("market_cap"),
                    "price": md.get("close"),
                    "fifty_two_week_high": None,
                    "fifty_two_week_low": None,
                }, ttl=600)

        duration = (datetime.utcnow() - started_at).total_seconds()
        print(f"[pipeline] Completed in {duration:.1f}s total")

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
            "duration_seconds": duration,
        }

    except Exception as e:
        run.finished_at = datetime.utcnow()
        run.status = "failed"
        run.error_message = str(e)
        await db.commit()
        raise
