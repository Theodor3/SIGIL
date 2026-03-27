# Provider Layer

## Purpose

This folder contains the normalized data-provider layer for the trading stack.

The goal is to keep vendor-specific API logic out of:

- ranking scripts
- regime logic
- execution logic
- dashboard generation

Instead of each script calling a vendor directly, scripts should use a provider client that returns a stable internal shape.

This makes it easier to:

- swap providers later
- mix primary providers with fallbacks
- expose provenance and freshness in the dashboard
- migrate incrementally without rewriting the whole stack

## Current Modules

### `env.mjs`

Loads local provider configuration from:

- `C:\Users\Theodore\OneDrive\Documents\Playground\.env.local`

Responsibilities:

- read local secrets safely
- avoid hard-coding secrets in scripts
- expose a small provider-env summary for dashboard visibility

### `market_data.mjs`

Normalized client for daily market bars.

Current use cases:

- benchmark returns
- daily market context
- regime market tape

Current provider order behavior:

- prefer `Polygon` or `Massive` when configured
- use `Finnhub` if selected and available
- fall back to `Yahoo` while migration is still in progress

### `reference_data.mjs`

Normalized client for quote and basic reference data.

Current use cases:

- execution playbook
- forward monitor
- price, volume, market cap, and basic sector/industry enrichment

### `fundamentals_data.mjs`

Normalized client for fundamentals and event-style enrichment.

Current use cases:

- growth scan fundamentals
- earnings calendar refresh
- company news collection

Current behavior:

- attempts a `Finnhub` path where it has useful coverage
- still uses `Yahoo` fallback for richer historical fundamentals needed by the current growth scan
- exposes event-style helpers such as `getEarningsCalendar()` and `getCompanyNews()`

### `build_event_data.mjs`

Builds provider-backed event contracts into local CSV files under:

- `trading/data/alt/`

Current outputs:

- `earnings_calendar.csv`
- `company_news.csv`
- `news_mentions_finnhub.csv`

This exists so the rest of the pipeline can keep consuming local contracts instead of needing to know about remote APIs.

## Local Secrets

Provider keys live in:

- `C:\Users\Theodore\OneDrive\Documents\Playground\.env.local`

Supported variables today:

- `POLYGON_API_KEY`
- `MASSIVE_API_KEY`
- `FINNHUB_API_KEY`
- `TRADING_MARKET_DATA_PROVIDER`
- `TRADING_FUNDAMENTALS_PROVIDER`
- `TRADING_DEFAULT_UNIVERSE`
- `TRADING_ENABLE_OPTIONS`

Operational note:

- `.env.local` is intentionally excluded locally from Git via `.git/info/exclude`

## Design Rules

When adding or changing provider code, keep these rules:

1. Return normalized internal shapes, not raw vendor payloads.
2. Keep vendor-specific field names inside provider modules only.
3. Prefer additive migration over big-bang replacement.
4. Preserve a safe fallback path while a migration is incomplete.
5. Make provenance visible when multiple sources are merged.
6. Avoid silently double-counting overlapping sources.

## Provenance

The provider layer is part of the system's risk control, not just plumbing.

Why this matters:

- a signal can look strong but still be based on stale data
- a fallback provider can behave differently from the preferred provider
- two news feeds can accidentally inflate one feature if merged incorrectly

That is why the dashboard now includes:

- provider environment visibility
- data provenance and freshness panels
- source provenance inside the nowcast payload

## Current Migration State

The migration is intentionally partial.

Already normalized:

- daily market bars
- quotes and basic reference data
- growth scan fundamentals path
- provider-backed event refresh
- nowcast news backfill provenance

Still being migrated incrementally:

- richer fundamentals coverage beyond the growth scan
- broader event enrichment
- more explicit freshness metadata inside model payloads
- remaining Yahoo-only research and utility paths

## Safe Extension Pattern

When adding a new capability, prefer this sequence:

1. add the new method to the provider client
2. normalize the output shape
3. write or refresh a local contract if the rest of the pipeline expects files
4. expose provenance and freshness if the source affects model trust
5. switch one downstream consumer at a time

This keeps the system debuggable while it grows.
