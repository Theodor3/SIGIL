"""Pipeline runner — orchestrates data fetch → signals → scoring → storage."""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.config.settings import settings
from api.data.context import PipelineContext
from api.data.fmp import FMPProvider
from api.data.universe import SEED_UNIVERSE, fetch_universe_tickers, screen_universe
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
    """Benchmark/breadth ETF stats via the Yahoo batch downloader — replaced
    Polygon, whose free tier needed 12s sleeps between its 13 calls."""
    yahoo = YahooProvider(demo_mode=settings.demo_mode)
    return await yahoo.fetch_benchmarks()


async def _fetch_fred() -> dict:
    if not settings.fred_api_key:
        return {}
    from api.data.fred import FredProvider
    return await FredProvider().fetch()


async def _fetch_edgar(bucket: list[str]) -> dict:
    from api.data.edgar import EdgarProvider
    return await EdgarProvider().fetch(bucket)


async def _fetch_buybacks(bucket: list[str]) -> dict:
    from api.data.buybacks import BuybackProvider
    return await BuybackProvider().fetch(bucket)


async def _fetch_wikipedia(bucket: list[str], fundamentals: dict | None = None) -> dict:
    from api.data.wikipedia import WikipediaProvider
    return await WikipediaProvider().fetch(bucket, fundamentals=fundamentals)


async def _fetch_gdelt(bucket: list[str], fundamentals: dict | None = None) -> dict:
    from api.data.gdelt import GdeltProvider
    return await GdeltProvider().fetch(bucket, fundamentals=fundamentals)


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


async def _fetch_fmp(bucket: list[str]) -> dict:
    if not settings.fmp_api_key:
        return {}
    from api.data.fmp import FMPProvider
    return await FMPProvider().fetch(bucket)


async def _fetch_tiingo_prices(bucket: list[str]) -> dict:
    if not settings.tiingo_api_key:
        return {}
    from api.data.tiingo import TiingoProvider
    return await TiingoProvider().fetch_prices(bucket)


async def _fetch_alphavantage_earnings(bucket: list[str]) -> dict:
    if not settings.alpha_vantage_api_key:
        return {}
    from api.data.alphavantage import AlphaVantageProvider
    return await AlphaVantageProvider().fetch_earnings(bucket)


async def _fetch_bls() -> dict:
    if not settings.bls_api_key:
        return {}
    from api.data.bls import BLSProvider
    return await BLSProvider().fetch()


async def _fetch_yahoo_prices(yahoo: YahooProvider, bucket: list[str]) -> dict:
    return await yahoo.fetch_prices(bucket)


async def _fetch_yahoo_fundamentals(yahoo: YahooProvider, bucket: list[str]) -> dict:
    return await yahoo.fetch(bucket)


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

        # Phase 1: Fetch multi-index universe + lightweight FMP fundamentals for screening
        yahoo = YahooProvider(demo_mode=settings.demo_mode)
        fmp = FMPProvider()
        universe = await fetch_universe_tickers()
        print(f"[pipeline] Fetched {len(universe)} tickers across all indices")

        # Watchlist tickers are force-included in the universe (and jump
        # the screening-refresh queue); an empty watchlist is a no-op
        from api.routes.watchlist import get_watchlist_tickers
        watchlist = await get_watchlist_tickers(db)
        if watchlist:
            universe_set = set(universe)
            universe += [t for t in watchlist if t not in universe_set]
            print(f"[pipeline] Watchlist: {len(watchlist)} force-included tickers")

        # Screening fundamentals come from the persistent cache; each run
        # spends its FMP quota refreshing a shuffled slice, so coverage
        # compounds across runs instead of resetting (and dying) every 6h
        from api.data.screening_cache import (
            choose_refresh, load_screening_cache, store_screening_cache,
        )
        cached = await load_screening_cache(db)
        refresh_list = choose_refresh(universe, cached, priority=watchlist)
        fresh = await fmp.fetch_screening_data(refresh_list)
        await store_screening_cache(db, fresh)

        universe_set = set(universe)
        fundamentals = {
            t: entry["data"] for t, entry in cached.items() if t in universe_set
        }
        fundamentals.update(fresh)
        print(f"[pipeline] Screening coverage: {len(fundamentals)}/{len(universe)} tickers "
              f"(cache {len(cached)}, refreshed {len(fresh)}/{len(refresh_list)})")
        update_source_status("fmp_fundamentals", SourceStatus.ACTIVE, fetch_count=len(fundamentals))
        update_source_status("universe_screener", SourceStatus.ACTIVE, fetch_count=len(universe))

        # Phase 2: Screen to growth bucket
        bucket = screen_universe(fundamentals)
        if not bucket:
            bucket = list(fundamentals.keys())[:75]
        if watchlist:
            in_bucket = set(bucket)
            bucket += [t for t in watchlist if t not in in_bucket]
        print(f"[pipeline] Universe: {len(bucket)} tickers after screening")

        # Phase 3: Fetch ALL other data sources IN PARALLEL
        t0 = datetime.utcnow()
        results = await asyncio.gather(
            _fetch_yahoo_prices(yahoo, bucket),        # 0
            _fetch_finnhub(bucket),                    # 1
            _fetch_benchmarks(),                       # 2
            _fetch_fred(),                             # 3
            _fetch_wikipedia(bucket, fundamentals),    # 4
            _fetch_gdelt(bucket, fundamentals),        # 5
            _fetch_insider(bucket),                    # 6
            _fetch_analyst(bucket),                    # 7
            _fetch_fmp(bucket),                        # 8  - full FMP fundamentals
            _fetch_tiingo_prices(bucket),              # 9
            _fetch_alphavantage_earnings(bucket),      # 10
            _fetch_bls(),                              # 11
            _fetch_yahoo_fundamentals(yahoo, bucket),  # 12 - Yahoo fundamentals on screened bucket
            fmp.fetch_price_targets(bucket),           # 13 - analyst price targets
            fmp.fetch_shares_float(bucket),            # 14 - shares float data
            fmp.fetch_analyst_estimates(bucket),       # 15 - forward estimates
            _fetch_edgar(bucket),                      # 16 - SEC filing red flags
            _fetch_buybacks(bucket),                   # 17 - buyback authorizations
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
        fmp_data = results[8] if not isinstance(results[8], Exception) else {}
        tiingo_prices = results[9] if not isinstance(results[9], Exception) else {}
        av_earnings = results[10] if not isinstance(results[10], Exception) else {}
        bls_data = results[11] if not isinstance(results[11], Exception) else {}
        yahoo_fund = results[12] if not isinstance(results[12], Exception) else {}
        price_targets = results[13] if not isinstance(results[13], Exception) else {}
        shares_float = results[14] if not isinstance(results[14], Exception) else {}
        forward_estimates = results[15] if not isinstance(results[15], Exception) else {}
        filing_flags = results[16] if not isinstance(results[16], Exception) else {}
        buyback_auths = results[17] if not isinstance(results[17], Exception) else {}

        # Log errors from any failed providers
        provider_names = [
            "yahoo_prices", "finnhub", "yahoo_benchmarks", "fred", "wikipedia",
            "gdelt", "insider", "analyst", "fmp", "tiingo_prices",
            "alphavantage", "bls", "yahoo_fundamentals",
            "fmp_price_targets", "fmp_shares_float", "fmp_forward_estimates",
            "edgar_filings",
        ]
        for i, name in enumerate(provider_names):
            if isinstance(results[i], Exception):
                print(f"[pipeline] {name} failed: {results[i]}")

        # Merge full FMP + Yahoo fundamentals into the screening fundamentals
        # Priority: FMP full > Yahoo > FMP screening data (already in fundamentals)
        merge_keys = [
            "roic", "fcf_margin", "asset_turnover", "debt_to_ebitda",
            "total_debt", "total_equity", "market_cap", "trailing_pe",
            "forward_pe", "price_to_sales", "ev_to_ebitda", "ev_to_revenue",
            "dividend_yield", "payout_ratio", "buyback_ttm",
        ]
        extra_keys = ("roe", "roa", "operating_margin", "net_margin", "current_ratio", "interest_coverage")

        # First merge Yahoo fundamentals (fills in what FMP screening didn't have)
        if yahoo_fund:
            update_source_status("yahoo_fundamentals", SourceStatus.ACTIVE, fetch_count=len(yahoo_fund))
            print(f"[pipeline] Yahoo fundamentals: {len(yahoo_fund)} tickers")
            for ticker, yf in yahoo_fund.items():
                if ticker not in fundamentals:
                    fundamentals[ticker] = yf
                    continue
                existing = fundamentals[ticker]
                for key in merge_keys:
                    if (existing.get(key) is None or existing.get(key) == 0) and yf.get(key) is not None and yf.get(key) != 0:
                        existing[key] = yf[key]
                for key in extra_keys:
                    if existing.get(key) is None and yf.get(key) is not None:
                        existing[key] = yf[key]

        # Then merge full FMP (wins over both Yahoo and screening data)
        if fmp_data:
            print(f"[pipeline] FMP full: {len(fmp_data)} tickers")
            for ticker, fmp_fund in fmp_data.items():
                if ticker not in fundamentals:
                    fundamentals[ticker] = fmp_fund
                    continue
                existing = fundamentals[ticker]
                for key in merge_keys:
                    fmp_val = fmp_fund.get(key)
                    if fmp_val is not None and fmp_val != 0:
                        existing[key] = fmp_val
                for key in extra_keys:
                    if fmp_fund.get(key) is not None:
                        existing[key] = fmp_fund[key]
        elif isinstance(results[8], Exception):
            update_source_status("fmp_fundamentals", SourceStatus.ERROR, error=str(results[8]))

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
            print(f"[pipeline] Yahoo benchmarks: {len(benchmarks)} fields")

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

        # Tiingo prices — fill gaps in Yahoo market data
        if not isinstance(results[9], Exception) and tiingo_prices:
            update_source_status("tiingo_prices", SourceStatus.ACTIVE, fetch_count=len(tiingo_prices))
            print(f"[pipeline] Tiingo prices: {len(tiingo_prices)} tickers")
            for ticker, tp in tiingo_prices.items():
                if ticker not in market_data or not market_data[ticker].get("close"):
                    market_data[ticker] = tp
        elif isinstance(results[9], Exception):
            update_source_status("tiingo_prices", SourceStatus.ERROR, error=str(results[9]))

        # Liquidity floor: names too thin to trade without paying the whole
        # spread are dropped from the tradable bucket entirely. Tickers with
        # unknown volume are kept (a missing quote is not evidence of
        # illiquidity); watchlist names are research-only and stay regardless.
        if settings.min_avg_dollar_volume > 0:
            from api.data.universe import ETF_UNIVERSE
            watch_set = set(watchlist or [])
            etf_set = set(ETF_UNIVERSE)

            def _adv(t: str) -> float:
                md = market_data.get(t) or {}
                vol = md.get("avg_volume_20d") or md.get("volume") or 0
                px = md.get("close") or 0
                return float(vol) * float(px)

            thin = [
                t for t in bucket
                if t not in etf_set and t not in watch_set
                and 0 < _adv(t) < settings.min_avg_dollar_volume
            ]
            if thin:
                thin_set = set(thin)
                bucket = [t for t in bucket if t not in thin_set]
                print(f"[pipeline] Liquidity filter: dropped {len(thin)} tickers "
                      f"under ${settings.min_avg_dollar_volume:,.0f} avg dollar volume")

        # Alpha Vantage earnings — merge into earnings history
        if not isinstance(results[10], Exception) and av_earnings:
            update_source_status("alphavantage_earnings", SourceStatus.ACTIVE, fetch_count=len(av_earnings))
            print(f"[pipeline] Alpha Vantage earnings: {len(av_earnings)} tickers")
            for ticker, av_data in av_earnings.items():
                if ticker not in earnings_history or not earnings_history[ticker]:
                    earnings_history[ticker] = av_data.get("surprise_history", [])
        elif isinstance(results[10], Exception):
            update_source_status("alphavantage_earnings", SourceStatus.ERROR, error=str(results[10]))

        # BLS labor data
        if not isinstance(results[11], Exception) and bls_data:
            update_source_status("bls_labor", SourceStatus.ACTIVE, fetch_count=len(bls_data))
            print(f"[pipeline] BLS: {len(bls_data)} labor indicators")
            macro.update(bls_data)
        elif isinstance(results[11], Exception):
            update_source_status("bls_labor", SourceStatus.ERROR, error=str(results[11]))

        # Merge shares float into fundamentals
        if shares_float:
            print(f"[pipeline] FMP shares float: {len(shares_float)} tickers")
            for ticker, sf in shares_float.items():
                if ticker in fundamentals:
                    fundamentals[ticker]["shares_outstanding"] = sf.get("outstanding_shares")
                    fundamentals[ticker]["float_shares"] = sf.get("float_shares")
                    fundamentals[ticker]["free_float_pct"] = sf.get("free_float_pct")

        # Log new FMP enrichment data
        if price_targets:
            print(f"[pipeline] FMP price targets: {len(price_targets)} tickers")
        if forward_estimates:
            print(f"[pipeline] FMP forward estimates: {len(forward_estimates)} tickers")

        # SEC EDGAR filing red flags
        if not isinstance(results[16], Exception) and filing_flags:
            flagged = sum(1 for f in filing_flags.values() if any(f.values()))
            update_source_status("edgar_filings", SourceStatus.ACTIVE, fetch_count=len(filing_flags))
            print(f"[pipeline] EDGAR: {len(filing_flags)} tickers checked, {flagged} flagged")
        elif isinstance(results[16], Exception):
            update_source_status("edgar_filings", SourceStatus.ERROR, error=str(results[16]))

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
            price_targets=price_targets,
            shares_float=shares_float,
            forward_estimates=forward_estimates,
            filing_flags=filing_flags,
            buyback_authorizations=buyback_auths,
            macro=macro,
            benchmarks=benchmarks,
        )

        # Archive the context for signal backtesting — a future signal can
        # be replayed over exactly what today's pipeline saw
        try:
            from api.research.context_store import save_context
            snap_path = save_context(ctx)
            print(f"[pipeline] Context snapshot: {snap_path.name} "
                  f"({snap_path.stat().st_size / 1024:.0f} KB)")
        except Exception as e:
            print(f"[pipeline] Context snapshot failed: {e}")

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

        # Phase 6: Run all signals — two passes. Everything except the LLM
        # runs first; a preliminary ranking then picks the LLM's shortlist,
        # so Claude studies the actual portfolio candidates instead of the
        # first N names in screening order.
        registry = get_registry()
        signal_outputs = {}
        for sig_name, signal in registry.items():
            if sig_name == "llm_conviction":
                continue
            try:
                outputs = await signal.compute(ctx)
                signal_outputs[sig_name] = outputs
                active_count = sum(1 for o in outputs if o.score > 0)
                print(f"[pipeline] Signal {sig_name}: {active_count}/{len(outputs)} active scores")
            except Exception as e:
                print(f"Signal {sig_name} failed: {e}")

        if "llm_conviction" in registry:
            try:
                prelim_weights = {n: s.default_weight for n, s in registry.items()}
                prelim = score_universe(signal_outputs, prelim_weights, regime)
                ctx.llm_focus = [s.ticker for s in prelim[:60]]
                print(f"[pipeline] LLM focus: top {len(ctx.llm_focus)} by preliminary rank")
                outputs = await registry["llm_conviction"].compute(ctx)
                signal_outputs["llm_conviction"] = outputs
                active_count = sum(1 for o in outputs if o.confidence > 0)
                print(f"[pipeline] Signal llm_conviction: {active_count}/{len(outputs)} active scores")
            except Exception as e:
                print(f"Signal llm_conviction failed: {e}")

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
