# Trading System

## Overview

This project is now organized around one production trading pipeline that converts raw signals into ranked ideas, risk-aware portfolio targets, execution guidance, forward-test tracking, governance checks, and dashboard-ready outputs.

The current design goal is not "find the most exciting stock." The goal is to generate a repeatable, explainable alpha process that can be improved with evidence instead of intuition.

Primary objective:

- maximize risk-adjusted excess return versus benchmark

Secondary objectives:

- keep outputs explainable
- keep account sizing realistic for a small account
- avoid ad hoc scripts that score ideas differently from the master pipeline
- make day-to-day operator decisions visible in the dashboard

## Workspace Structure

Trading is expected to run from the workspace root:

- `C:\Users\Theodore\OneDrive\Documents\Playground\package.json`
- `C:\Users\Theodore\OneDrive\Documents\Playground\scripts\run_growth_scan.mjs`
- `C:\Users\Theodore\OneDrive\Documents\Playground\trading\...`

This matters because root npm scripts and shared dependencies are used by the trading pipeline and dashboard refresh flow.

## Provider Architecture

The trading stack is no longer only a collection of CSV readers plus Yahoo-based fetches.

It now has a provider layer that is intended to decouple:

- market data collection
- quote and reference data
- fundamentals and event data
- downstream feature and ranking logic

Primary provider modules:

- `trading/providers/env.mjs`
- `trading/providers/market_data.mjs`
- `trading/providers/reference_data.mjs`
- `trading/providers/fundamentals_data.mjs`
- `trading/providers/build_event_data.mjs`

Current design intent:

- `Polygon` or `Massive` should be the primary market-data backbone when keys are available
- `Finnhub` should provide fundamentals, earnings, company news, and reference enrichment where possible
- `Yahoo` remains as a fallback path while the migration is still in progress

This is intentionally incremental.

The goal is to replace fragile one-off vendor calls with normalized provider clients, not to rewrite the entire stack in one pass.

### Local Secrets

Local provider keys are expected in:

- `C:\Users\Theodore\OneDrive\Documents\Playground\.env.local`

Current supported variables:

- `POLYGON_API_KEY`
- `MASSIVE_API_KEY`
- `FINNHUB_API_KEY`
- `TRADING_MARKET_DATA_PROVIDER`
- `TRADING_FUNDAMENTALS_PROVIDER`

Operational note:

- `.env.local` is excluded locally from Git via `.git/info/exclude`
- the dashboard now makes provider fallback more visible so hidden Yahoo-only operation is easier to spot

## Master Pipeline

Single source of truth:

- `trading/pipeline/run_alpha_pipeline.mjs`

Current production flow:

1. update raw signals and benchmark context
2. refresh provider-backed earnings and company-news event contracts
3. build standardized features
4. score and rank names
5. run regime model
6. run signal quality model
7. construct constrained portfolio targets
8. build execution playbook
9. simulate execution costs and trade plan realism
10. update forward-test monitor
11. run benchmark and backtest updates
12. run governance and promotion checks
13. publish dashboard data

The pipeline is intended to be the only path that feeds top ideas, risk views, and dashboard outputs.

## Core Data Contracts

The system now relies on standardized CSV outputs rather than script-specific ranking logic.

Primary feature and ranking outputs:

- `trading/data/features/latest_features.csv`
- `trading/data/ranks/latest_ranks.csv`

Core ranking fields:

- `ticker`
- `as_of_date`
- `value_score`
- `quality_score`
- `growth_score`
- `alt_momentum_score`
- `peer_relative_score`
- `risk_penalty`
- `liquidity_penalty`
- `final_alpha_score`
- `confidence`

Additional production contracts:

- `trading/data/regime/latest_regime.csv`
- `trading/data/quality/latest_signal_quality.csv`
- `trading/data/portfolio/latest_target_weights.csv`
- `trading/data/execution/latest_trade_plan.csv`
- `trading/data/scorecard/latest_model_scorecard.csv`

Provider-backed event and provenance contracts now also exist:

- `trading/data/alt/earnings_calendar.csv`
- `trading/data/alt/company_news.csv`
- `trading/data/alt/news_mentions_finnhub.csv`
- `trading/data/alt/news_mentions_provenance.csv`

Validation layer:

- `trading/pipeline/validate_data_contracts.mjs`

The intent is simple:

- feature writers write features
- rankers read standardized features
- portfolio logic reads standardized ranks plus regime/quality
- top ideas are downstream of the final ranks, not separate scoring logic

## Alpha Model and Hard Gates

Weighted alpha model config:

- `trading/config/alpha_model.json`

Baseline formula started with:

- `0.30 * quality`
- `0.25 * growth`
- `0.20 * alt_momentum`
- `0.15 * peer_relative`
- `0.10 * value`
- minus risk penalties

Hard gates now exist around:

- minimum confidence
- liquidity and execution realism
- leverage and portfolio constraint checks
- weak-signal exclusions
- governance freeze behavior for promotion logic

No script should publish its own final ranking independently if it is not using the unified schema and alpha model path.

## Regime Model

Primary regime engine:

- `trading/regime/run_regime_model.mjs`

Daily market context builder:

- `trading/regime/run_daily_market_context.mjs`

Policy file:

- `trading/config/regime_policy.json`

Current regime model started as a simple classifier using benchmark return context, especially:

- SPY recent returns
- QQQ recent returns
- QQQ versus SPY spread

Core states:

- `risk_on`
- `risk_off`
- `high_vol`
- `trend_growth`

Current output contract includes:

- `as_of_date`
- `source_market_date`
- `regime_id`
- `regime_confidence`
- `vol_state`
- `rates_state`
- `breadth_state`
- `sector_leadership_state`
- `recommended_gross_exposure`

### Regime V2

Regime V2 upgrades the system from "label the market" to "change portfolio behavior."

The most important new behavior:

- regime now alters factor preference, not just gross exposure
- regime now prefers a dedicated daily market tape over event-date benchmark rows
- sector leadership now affects both factor tilt and portfolio scoring

Configured factor tilts per regime are stored in:

- `trading/config/regime_policy.json`

Daily market context currently includes:

- SPY and QQQ trailing returns
- RSP relative breadth
- sector participation breadth
- VIX level and VIX change
- realized volatility
- top sector leaders and laggards

Examples:

- `risk_off` favors quality and value more heavily
- `high_vol` reduces reliance on alt momentum and softens growth bias
- `trend_growth` boosts growth and alt momentum
- `risk_on` remains closer to neutral

## Signal Quality Model

Signal quality engine:

- `trading/quality/run_signal_quality.mjs`

Output:

- `trading/data/quality/latest_signal_quality.csv`

Quality output fields include:

- `ticker`
- `as_of_date`
- `coverage_score`
- `staleness_score`
- `cross_source_agreement`
- `quality_penalty`
- `effective_confidence`

Purpose:

- penalize weak or stale names before portfolio construction
- make confidence a data-quality-aware metric instead of a raw rank score

## Alternative Data Nowcast

Primary nowcast engine:

- `trading/nowcast/run_alt_nowcast.mjs`

Direct source builder:

- `trading/nowcast/build_direct_alt_sources.mjs`

Proxy source builder:

- `trading/nowcast/build_market_proxy_sources.mjs`

Current nowcast inputs are a mix of real direct sources and market-inferred proxies.

Current direct sources:

- Wikimedia pageview trends via `search_trends.csv`
- news mention counts via `news_mentions.csv`

Current proxy sources:

- `market_price_proxy.csv`
- `market_volume_proxy.csv`

Current nowcast inputs can also support:

- direct alternative sources such as website traffic, app rank, search trends, price/promo, and foot-traffic
- proxy sources such as market price and market volume when direct coverage is thin

Current output files:

- `trading/output/YYYY-MM-DD-alt-nowcast-top20.csv`
- `trading/output/YYYY-MM-DD-alt-nowcast-top20.md`

Important fields now include:

- `confidence_score`
- `source_mix`
- `direct_source_count`
- `proxy_source_count`
- `proxy_share`
- per-source YoY fields such as `search_trends_yoy`, `news_mentions_yoy`, `market_price_proxy_yoy`, and `market_volume_proxy_yoy`
- per-source provenance fields such as `search_trends_provenance`, `news_mentions_provenance`, `market_price_proxy_provenance`, and `market_volume_proxy_provenance`
- `source_provenance_summary`
- `expected_kpi_surprise`
- `probability_post_earnings_outperform`
- `deviation_vs_consensus`

Interpretation:

- `direct` means the nowcast is driven by true alternative inputs
- `proxy_only` means the signal is derived only from market proxies and should be treated as weaker evidence
- `hybrid` means both direct and proxy inputs contributed

The nowcast confidence model now applies a small penalty when coverage is proxy-only so the dashboard does not overstate conviction.

### News Provenance

The news path now has an explicit provenance rule.

Current behavior:

- `news_mentions.csv` is still the canonical nowcast news contract
- direct GDELT-style news coverage remains the preferred source when available
- `news_mentions_finnhub.csv` is used only as a backfill path
- provider-backed news is merged conservatively so article counts are not double-counted as if they were two independent signals
- `news_mentions_provenance.csv` records whether a ticker's merged news signal is primarily `gdelt` or `finnhub_backfill`

This is important because news-count features are especially easy to overstate if multiple article-volume feeds are treated as separate evidence.

Operational note:

- direct-source collection is intentionally conservative
- direct data is cached and reused to avoid hammering Wikimedia or GDELT
- expand mappings for priority names rather than broadening the crawl aggressively

### Signal Taxonomy Cleanup

The alpha pipeline now separates:

- true alternative-data confirmation
- proxy-inferred market signal

This means:

- `alt_momentum_score` and `peer_relative_score` are reserved for `direct` or `hybrid` nowcast coverage
- `proxy_only` nowcast no longer feeds those sleeves directly
- proxy-backed names instead flow through a smaller `proxy_inferred_score` sleeve in the alpha model

This avoids double-counting thin proxy-based nowcast as if it were full alternative-data confirmation.

## Portfolio Construction and Risk

Constructor:

- `trading/portfolio/run_portfolio_constructor.mjs`

Constraints config:

- `trading/config/portfolio_constraints.json`

The constructor now blends raw alpha with regime-specific factor tilt.

Current production behavior:

- compute `regime_tilt_score` from factor columns
- combine base regime tilt with sector-leadership tilt
- blend `60% final_alpha_score`
- blend `40% regime_tilt_score`
- apply sector alignment bonus or penalty for names in leading or lagging sectors
- apply confidence, risk penalties, and regime multiplier

Current target output:

- `trading/data/portfolio/latest_target_weights.csv`

Key fields include:

- `ticker`
- `final_alpha_score`
- `regime_tilt_score`
- `risk_adjusted_score`
- `target_weight`
- `max_weight_allowed`
- `sector_bucket`
- `constraint_flags`

This is the first version of regime-aware ranking that meaningfully changes which names rise in the portfolio.

## Execution Playbook

Execution playbook engine:

- `trading/execution/run_execution_playbook.mjs`

Policy:

- `trading/config/playbook_policy.json`

Each final idea should carry operator guidance, not just a score.

Current outputs include:

- entry zone
- invalidation condition
- trim schedule
- max position size
- optional options overlay suggestion when liquidity and account-size rules permit it

## Execution Simulator

Execution cost realism engine:

- `trading/execution/run_execution_simulator.mjs`

Cost model config:

- `trading/config/execution_cost_model.json`

Output:

- `trading/data/execution/latest_trade_plan.csv`

Trade-plan fields include:

- `ticker`
- `action`
- `shares_delta`
- `est_slippage_bps`
- `est_cost_usd`
- `entry_zone_low`
- `entry_zone_high`
- `invalidation_price`
- `trim_plan`
- `options_overlay`
- `options_gate_reason`

Purpose:

- reject unrealistic trade plans
- add account-aware realism before acting on a ranked list

## Backtest

Backtest engine:

- `trading/backtest/run_alpha_backtest.mjs`

Benchmark support:

- `trading/backtest/run_benchmark_returns.mjs`

Backtest reports are designed to support model comparison, not just vanity metrics.

Current key outputs:

- CAGR
- Sharpe
- max drawdown
- hit rate
- bucket-level alpha

Backtest changes should not drive automatic model promotion by themselves.

## Forward Test

Forward monitor:

- `trading/forward/run_forward_monitor.mjs`

Policy:

- `trading/config/forward_policy.json`

Purpose:

- maintain a live paper ledger of ideas
- track open and closed recommendations
- enforce cooldowns and close-window logic
- provide real-world evidence before promoting a challenger model

## Governance and Promotion

Governance checks:

- `trading/governance/run_governance_checks.mjs`

Scorecard:

- `trading/governance/run_model_scorecard.mjs`

Key governance outputs:

- `trading/governance/latest_governance.json`
- `trading/governance/model_change_log.csv`
- `trading/config/model_registry.json`
- `trading/data/scorecard/latest_model_scorecard.csv`

Promotion policy now checks:

- champion versus challenger result
- minimum backtest sample
- minimum number of closed forward trades
- forward alpha versus expectation threshold
- freeze policy violations

This keeps promotions from happening just because a challenger looks better on paper.

## Dashboard

Dashboard server and UI:

- `trading/dashboard/server.mjs`
- `trading/dashboard/index.html`

Dashboard data generator:

- `trading/dashboard/generate_dashboard_data.mjs`

Current dashboard is no longer just a top-ideas page. It is an operator console for the full system.

Major panels now include:

- current top ideas
- promotion readiness
- portfolio risk console
- idea drilldown
- catalyst calendar
- changed since last run
- active regime tilt
- forward-test visibility
- platform roadmap
- data provenance

### Idea Drilldown

The drilldown view is designed to answer:

- why this ticker
- why now
- what is supporting the thesis
- how to execute it
- how it fits the current regime

The payload merges data from rank, features, signal quality, execution, nowcasting context, regime, and forward-test status.

The drilldown now also exposes source-level nowcast evidence, including:

- source mix
- direct versus proxy counts
- strongest nowcast drivers
- source-by-source YoY signals for direct and proxy inputs
- source-by-source provenance so the operator can distinguish direct collection from provider backfill and proxy paths

### Data Provenance

This panel is the operator sanity check for the backend itself.

It shows:

- active provider preferences from local env configuration
- whether keys appear present for primary providers
- freshness state of important contracts such as market context, benchmark returns, earnings calendar, company news, merged news mentions, Finnhub news backfill, and search trends
- row counts and latest data dates for each contract

This exists because a model can look coherent while still running on stale files, missing event coverage, or fallback vendors.

### Portfolio Risk Console

The risk console summarizes the shape of the current book and the model target book.

Current metrics include:

- weighted beta proxy
- top-five concentration
- max single-name weight
- max sector weight
- cash buffer
- HHI concentration
- breached policy flags
- top positions
- sector exposure
- target drift

### Catalyst Calendar

The catalyst calendar is intended to keep the operator aware of dated events that affect decision timing.

Current coverage includes:

- earnings dates where available
- governance freeze unlock dates
- forward-test review checkpoints
- forward close-window dates

### Changed Since Last Run

The dashboard now explicitly compares current output versus the previous dated run and reports:

- lineup changes
- names added
- names removed
- score changes
- expected alpha changes

This exists because a stable top-five list can still have meaningful internal movement.

### Direct Source Coverage

This panel is the operating view for alt-data depth on the names we actually care about.

It shows:

- tracked symbols
- direct, hybrid, proxy-only, and no-nowcast counts
- per-name source mix and coverage
- a coverage-target queue for names missing direct support

### Direct Source Leaderboard

This panel ranks names by actual direct-source strength rather than generic nowcast presence.

It now shows:

- direct signal score
- best direct source
- average absolute direct-source magnitude
- strongest nowcast drivers

This is intended to separate real alternative-data evidence from names that only look active because proxy signals are loud.

### Active Regime Tilt

This panel explains how the current regime is changing model behavior.

It shows:

- market data source date
- current regime
- regime confidence
- recommended gross exposure
- active multiplier
- vol and breadth state
- sector leadership state
- equal-weight breadth and sector participation
- top sector leaders and laggards
- a short "why this regime" explanation
- factor tilt table with overweight, underweight, and neutral signals

## Commands

Useful root-level commands:

- `npm run trading:alpha`
- `npm run trading:dashboard:data`
- `npm run trading:portfolio`
- `npm run trading:execution:sim`
- `npm run trading:scorecard`
- `npm run trading:quality`
- `npm run trading:regime`

These should be run from:

- `C:\Users\Theodore\OneDrive\Documents\Playground`

## Current Known Gaps

This system is materially better than the original script collection, but there are still real gaps.

Known gaps:

- regime classification is materially better than the old version but still has room to improve further with richer breadth, volatility, and market-internals inputs
- options overlay logic should be tightened further for account-size realism
- catalyst and direct-source coverage are still thin for some names
- some fundamentals still rely on Yahoo fallback because the normalized provider layer is being migrated incrementally
- source freshness is now visible, but freshness is not yet embedded into every model component directly
- dashboard UX can continue improving, but the current operator tooling is already much stronger than the original setup
- top-idea stability should continue to be monitored so real signal movement is visible without forcing unnecessary turnover

## Current System State

At this stage, the trading stack has moved from:

- disconnected scans and scripts

to:

- one master pipeline
- one ranking path
- one governance path
- one dashboard data publication path

That is the most important architectural improvement made so far.
