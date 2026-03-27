# Dashboard Guide

## Purpose

The trading dashboard is the operator view of the alpha pipeline.

It is meant to answer four questions quickly:

1. what are the best current ideas
2. what changed since the last run
3. how much risk is the model taking
4. why is the model leaning the way it is

Primary files:

- `C:\Users\Theodore\OneDrive\Documents\Playground\trading\dashboard\index.html`
- `C:\Users\Theodore\OneDrive\Documents\Playground\trading\dashboard\generate_dashboard_data.mjs`
- `C:\Users\Theodore\OneDrive\Documents\Playground\trading\dashboard\data\dashboard_data.json`

## How To Refresh

Run from the workspace root:

```bash
npm run trading:dashboard:data
```

For a full refresh of pipeline outputs plus the dashboard:

```bash
npm run trading:alpha
```

If the page looks stale:

1. regenerate dashboard data
2. hard refresh the browser with `Ctrl+F5`

## Main Panels

### Current Top Ideas

Shows the current final ranked idea set produced by the master pipeline.

Use it to answer:

- what names are currently favored
- what scores are strongest
- what expected alpha is being projected

### Idea Drilldown

The drilldown is the best single-ticker research view in the dashboard.

It combines:

- factor scores
- execution plan
- signal quality
- fundamentals
- nowcast context
- regime context
- forward-test status

Use it to answer:

- why this name is in the stack
- which factors are doing the work
- what the execution plan is
- what invalidates the idea
- whether the nowcast is direct, hybrid, proxy-only, or missing
- which individual sources are actually moving the signal
- whether a source is truly direct, provider-backed backfill, or a proxy path

### Portfolio Risk Console

This panel summarizes book shape and concentration.

Key readings:

- weighted beta proxy
- top-five concentration
- max single-name weight
- max sector weight
- cash buffer
- HHI concentration
- target drift
- breached policy flags

Use it before adding size to confirm the system is not leaning too hard into one theme or one name.

### Active Regime Tilt

This panel explains how the current market regime is changing factor behavior.

Shows:

- current regime
- regime confidence
- recommended gross exposure
- active multiplier
- volatility state
- breadth state
- factor tilt table

Use it to answer:

- whether the model is leaning toward growth, quality, value, or momentum
- whether current top ideas fit the market tape

### Promotion Readiness

This panel tracks champion versus challenger governance status.

Shows:

- current winner
- whether promotion was executed
- backtest gate status
- forward-test gate status
- freeze-policy status
- reason promotion is blocked or allowed

Use it to answer:

- whether the system is actually ready to promote a challenger
- whether model changes are earning their way into production

### Catalyst Calendar

This panel keeps dated events visible.

Current event types include:

- earnings where available
- governance freeze unlock dates
- forward-test review checkpoints
- forward close windows

Use it to avoid getting surprised by timing-sensitive events.

### Changed Since Last Run

This panel compares the current run with the prior dated output.

Shows:

- additions
- removals
- score changes
- expected alpha changes

Use it when the lineup feels stable and you want to know whether the internals actually moved.

### Direct Source Coverage

This panel is the health check for alternative-data depth.

Shows:

- tracked names
- direct coverage count
- hybrid count
- proxy-only count
- no-nowcast count
- per-name source mix and counts

Use it to answer:

- whether the active idea set actually has real alt coverage
- which names still depend on proxies
- where data expansion work matters most

### Coverage Targets

This panel prioritizes the highest-value names that still lack real direct-source support.

Use it to answer:

- which unresolved names deserve mapping work next
- whether the current weakness is on a top-ranked name or a lower-priority tail name

### Direct Source Leaderboard

This panel ranks names by direct-source strength, not just nowcast existence.

Shows:

- direct signal score
- best direct source
- average direct-source magnitude
- strongest drivers

Use it to answer:

- which names have the strongest real external attention signal
- whether a name is being supported by direct data or mostly by proxies

### Data Provenance

This panel is the backend health view.

Shows:

- configured market-data and fundamentals provider preferences
- whether provider keys appear present
- freshness state for critical contracts
- latest data date per contract
- row counts and notes for the main provider-fed files

Use it to answer:

- whether the system is operating on fresh or stale inputs
- whether a dataset is missing entirely
- whether the pipeline is running on a preferred provider path or a fallback path

### Platform Roadmap

This panel is the live build-status view for the console itself.

Use it to answer:

- what backend work is currently in progress
- which architecture steps are planned next
- whether the stack is still focused on paper-traded longs or has moved into later phases

## Reading The Dashboard Correctly

The dashboard is not a blind buy list.

Interpret it in this order:

1. check the regime and portfolio risk posture
2. inspect the top ideas
3. use drilldown to understand a specific name
4. confirm execution plan and invalidation
5. review what changed since the last run
6. check direct-source coverage before trusting alt-heavy names
7. check data provenance when anything looks implausible, stale, or too clean

This prevents reacting to a single high score without understanding context.

## Known Limitations

- catalyst coverage is only as good as local event data
- regime classification is still fairly simple and should improve over time
- stable top names do not mean nothing changed internally
- dashboard freshness depends on regenerating `dashboard_data.json`
- direct-source coverage is still uneven across the active universe
- proxy-backed nowcast should still be treated as weaker than direct or hybrid coverage
- some provider-backed contracts may still fall back to Yahoo or local static files during the migration period

## Recommended Operator Workflow

Daily:

1. run `npm run trading:alpha`
2. open the dashboard
3. check `Active Regime Tilt`
4. check `Portfolio Risk Console`
5. review `Changed Since Last Run`
6. open `Idea Drilldown` for the top one or two names

Weekly:

1. review `Promotion Readiness`
2. review forward-test outcomes
3. confirm no governance or freeze-policy issues
