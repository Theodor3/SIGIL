# Pipeline Commands

## Purpose

This is the quick runbook for operating the trading system from the terminal.

Run all commands from:

- `C:\Users\Theodore\Documents\Playground`

## Core Commands

### Full Pipeline

Runs the end-to-end trading stack:

```bash
npm run trading:alpha
```

Use this when you want a full refresh of:

- signals
- provider-backed event contracts
- features
- ranks
- regime
- signal quality
- portfolio targets
- execution outputs
- forward monitor
- backtest and benchmarks
- governance checks
- dashboard data

### Dashboard Data Only

Refreshes the dashboard payload without rerunning the whole pipeline:

```bash
npm run trading:dashboard:data
```

Use this after UI-only changes or after checking that upstream files are already current.

## Component Commands

### Regime

```bash
npm run trading:regime
```

Writes:

- `trading/data/regime/latest_regime.csv`

Prefers:

- `trading/data/alt/daily_market_context.csv`

Falls back to:

- `trading/data/alt/benchmark_returns.csv`

### Daily Market Context

```bash
npm run trading:market-context
```

Writes:

- `trading/data/alt/daily_market_context.csv`

This is the dedicated daily market tape used by the regime model. It includes:

- index return context
- VIX and realized volatility
- equal-weight breadth
- sector participation breadth
- top sector leaders and laggards

### Alternative Data Nowcast

```bash
node trading/providers/build_event_data.mjs
node trading/nowcast/build_direct_alt_sources.mjs
node trading/nowcast/build_market_proxy_sources.mjs
node trading/nowcast/run_alt_nowcast.mjs
```

Writes:

- `trading/data/alt/earnings_calendar.csv`
- `trading/data/alt/company_news.csv`
- `trading/data/alt/news_mentions_finnhub.csv`
- `trading/data/alt/news_mentions_provenance.csv`
- `trading/data/alt/search_trends.csv`
- `trading/data/alt/news_mentions.csv`
- `trading/data/alt/market_price_proxy.csv`
- `trading/data/alt/market_volume_proxy.csv`
- `trading/output/YYYY-MM-DD-alt-nowcast-top20.csv`

Use this when you are specifically testing nowcast coverage or checking whether direct and proxy-backed names are flowing into the signal layer.

Key nowcast fields:

- `source_mix`
- `direct_source_count`
- `proxy_source_count`
- `proxy_share`
- `search_trends_yoy`
- `news_mentions_yoy`
- `market_price_proxy_yoy`
- `market_volume_proxy_yoy`
- `source_provenance_summary`
- per-source provenance fields such as `news_mentions_provenance`

Operational note:

- `build_direct_alt_sources.mjs` is intentionally conservative
- direct-source files are meant to be reused within the same day
- avoid repeatedly rerunning it unless mappings or source logic changed
- provider-backed news is merged as a backfill path and is not intended to double-count article volume

### Signal Quality

```bash
npm run trading:quality
```

Writes:

- `trading/data/quality/latest_signal_quality.csv`

### Portfolio Construction

```bash
npm run trading:portfolio
```

Writes:

- `trading/data/portfolio/latest_target_weights.csv`

This is where `regime_tilt_score` is blended into portfolio selection.

### Execution Simulation

```bash
npm run trading:execution:sim
```

Writes:

- `trading/data/execution/latest_trade_plan.csv`

### Model Scorecard

```bash
npm run trading:scorecard
```

Writes:

- `trading/data/scorecard/latest_model_scorecard.csv`

## Common Workflows

### Daily Refresh

```bash
npm run trading:alpha
```

Then:

1. hard refresh the dashboard
2. check `Changed Since Last Run`
3. inspect `Portfolio Risk Console`
4. inspect `Idea Drilldown`

### After UI Changes

```bash
npm run trading:dashboard:data
```

Use this when the code changed only in:

- `trading/dashboard/index.html`
- `trading/dashboard/generate_dashboard_data.mjs`

### After Regime Logic Changes

```bash
npm run trading:regime
npm run trading:portfolio
npm run trading:dashboard:data
```

### After Alternative-Data Source Changes

```bash
node trading/providers/build_event_data.mjs
node trading/nowcast/build_direct_alt_sources.mjs
node trading/nowcast/build_market_proxy_sources.mjs
npm run trading:nowcast
npm run trading:dashboard:data
```

Use this after changing:

- `trading/providers/build_event_data.mjs`
- `trading/providers/fundamentals_data.mjs`
- `trading/nowcast/build_direct_alt_sources.mjs`
- `trading/nowcast/config/wiki_page_map.json`
- `trading/nowcast/config/news_query_map.json`
- `trading/nowcast/run_alt_nowcast.mjs`
- `trading/dashboard/generate_dashboard_data.mjs`

This is the shortest useful verification chain when factor tilt or regime rules change.

If the change touches market tape or breadth logic, use:

```bash
npm run trading:market-context
npm run trading:regime
npm run trading:portfolio
npm run trading:dashboard:data
```

## Files To Check After A Run

Core health checks:

- `C:\Users\Theodore\Documents\Playground\trading\dashboard\data\dashboard_data.json`
- `C:\Users\Theodore\Documents\Playground\trading\data\portfolio\latest_target_weights.csv`
- `C:\Users\Theodore\Documents\Playground\trading\data\execution\latest_trade_plan.csv`
- `C:\Users\Theodore\Documents\Playground\trading\governance\latest_governance.json`

Useful sanity checks:

- confirm `generated_at` is current in `dashboard_data.json`
- confirm top names and scores changed when expected
- confirm regime is plausible
- confirm no constraint flags or governance issues appeared unexpectedly
- confirm the `Data Provenance` panel reports fresh or at least plausible contract freshness

## Troubleshooting

### Dashboard Looks Old

1. run `npm run trading:dashboard:data`
2. hard refresh with `Ctrl+F5`
3. inspect `dashboard_data.json` and confirm the timestamp is current

### Top Ideas Look Frozen

Check:

- `Changed Since Last Run` in the dashboard
- dated files under `trading/ideas`
- score movement in `latest_target_weights.csv`

Stable names do not necessarily mean stale data.

### Trading Commands Fail From The Wrong Directory

Make sure you are running from:

- `C:\Users\Theodore\Documents\Playground`

The trading setup currently expects root-level npm scripts and shared dependencies.
