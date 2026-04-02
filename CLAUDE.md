# Sigil Trading Console — Claude Code Project

## Who you are
You are the **lead quantitative engineer** on this project. You have full read/write access to this codebase and can spawn sub-agents to handle parallel workstreams (data fetching, backtesting, signal research, dashboard work). When a task is large or parallelizable, delegate it — don't do everything serially yourself.

## Owner
**Theodore Maiello**, 27, NYC. BMCC student finishing his degree. Waiter at Gabriel's Bar and Restaurant. Building this system to eventually generate alpha from quantitative signals. **Not live trading yet** — all execution is paper/simulated. Goal is to get to live Alpaca trading when the signals are validated.

Account: ~$14,500 total ($8,225 equities, $2,172 crypto, $4,111 cash)
Risk tolerance: high-controlled, growth-oriented, long-term with partial trims

---

## Project layout

```
Playground/
├── CLAUDE.md                        ← you are here
├── package.json                     ← npm scripts (see below)
├── launch-dashboard.bat             ← Windows: run pipeline + open browser
├── trading/
│   ├── pipeline/
│   │   └── run_alpha_pipeline.mjs   ← MASTER orchestrator — runs everything
│   ├── providers/
│   │   ├── fundamentals_data.mjs    ← Finnhub/Polygon fundamentals client
│   │   ├── market_data.mjs          ← price data
│   │   ├── build_event_data.mjs     ← earnings calendar + company news (Finnhub)
│   │   ├── build_earnings_history.mjs ← PEAD: historical post-earnings returns
│   │   └── env.mjs                  ← loads .env.local
│   ├── nowcast/
│   │   ├── build_direct_alt_sources.mjs  ← Wikipedia pageviews + GDELT news
│   │   ├── build_market_proxy_sources.mjs
│   │   ├── run_alt_nowcast.mjs           ← combines alt sources → nowcast signal
│   │   └── config/
│   │       ├── wiki_page_map.json        ← ticker → Wikipedia page title (96 entries)
│   │       ├── news_query_map.json       ← ticker → GDELT search query (95 entries)
│   │       └── model_config.json         ← top_n=50
│   ├── regime/
│   │   ├── run_daily_market_context.mjs
│   │   └── run_regime_model.mjs         ← risk_on/risk_off/high_vol/trend_growth
│   ├── scripts/
│   │   ├── lib.mjs                       ← shared utils (parseCsv, toCsv, asNum…)
│   │   ├── run_earnings_drift_lab.mjs    ← PEAD alpha lab analysis
│   │   ├── run_factor_tournament.mjs
│   │   ├── run_nowcast_ablation.mjs
│   │   ├── run_daily_top5.mjs
│   │   └── run_risk_board.mjs
│   ├── backtest/
│   │   ├── run_alpha_backtest.mjs
│   │   └── run_benchmark_returns.mjs
│   ├── portfolio/
│   │   └── run_portfolio_constructor.mjs
│   ├── execution/
│   │   ├── run_execution_playbook.mjs
│   │   └── run_execution_simulator.mjs
│   ├── forward/
│   │   └── run_forward_monitor.mjs       ← tracks paper trades
│   ├── governance/
│   │   ├── run_governance_checks.mjs
│   │   └── run_model_scorecard.mjs
│   ├── quality/
│   │   └── run_signal_quality.mjs
│   ├── dashboard/
│   │   ├── index.html                    ← single-file dashboard UI
│   │   ├── server.mjs                    ← local HTTP server on port 5180
│   │   ├── generate_dashboard_data.mjs   ← builds dashboard_data.json
│   │   └── data/dashboard_data.json
│   ├── config/
│   │   ├── alpha_model.json              ← factor weights + gates
│   │   ├── profile.json                  ← investor profile + account
│   │   ├── portfolio_constraints.json
│   │   ├── regime_policy.json
│   │   └── …
│   └── data/
│       ├── features/latest_features.csv  ← per-ticker factor scores (pipeline output)
│       ├── ranks/latest_ranks.csv
│       ├── alt/
│       │   ├── earnings_outcomes.csv     ← PEAD: 484 rows, 105 tickers, real data
│       │   ├── earnings_calendar.csv     ← upcoming earnings dates
│       │   ├── consensus_estimates.csv
│       │   ├── news_mentions.csv
│       │   └── …
│       └── alpha_lab/
│           └── latest_earnings_drift_lab.json
└── scripts/
    └── run_growth_scan.mjs               ← universe screener (runs first in pipeline)
```

---

## Alpha model — 7 factors

Weights live in `trading/config/alpha_model.json`. Currently:

| Factor | Weight | What it measures |
|---|---|---|
| quality | 0.27 | ROIC, FCF margin, asset turnover, balance sheet |
| growth | 0.22 | Revenue CAGR 3y, FCF CAGR 3y |
| alt_momentum | 0.13 | Wikipedia pageviews + GDELT news sentiment vs consensus |
| peer_relative | 0.12 | KPI deviation vs peer group from nowcast |
| value | 0.10 | Valuation score (P/E, EV/EBITDA vs sector) |
| proxy_inferred | 0.08 | Market-proxy signals for names with no direct alt data |
| **pead** | **0.08** | **Post-Earnings Announcement Drift — NEW** |

**Gates** (in same file): min_confidence 0.58, max_debt_to_ebitda 3.0, earnings_event_window_days 10, pead_min_samples 2, pead_max_days_to_earnings 45.

### PEAD signal detail
- `build_earnings_history.mjs` fetches real historical announcement dates + 5-day post-earnings returns (Finnhub primary, Yahoo Finance fallback, ~35-day quarter-end offset for approximate announcement date)
- `pead_raw = max(avg_return_5d, 0) × hit_rate × beat_probability × proximity`
- Proximity ramps from 0.2 (45 days out) to 1.0 (≤5 days)
- Zeroed out when no upcoming earnings within 45 days or <2 historical samples
- 484 real rows across 105 tickers currently seeded

---

## Data providers

API keys live in `trading/.env.local` (never commit this file):
- `FINNHUB_API_KEY` — earnings calendar, company news, fundamentals, earnings history
- `POLYGON_API_KEY` or `MASSIVE_API_KEY` — market price data
- Keys are loaded by `providers/env.mjs` via `loadLocalEnv()`

**Known issues with data:**
- GDELT API rate-limits aggressively — many "skipped" entries are normal
- Finnhub `period` field = fiscal quarter-end date (not announcement date) — we add ~35 days to approximate
- Wikipedia coverage: 92% of universe (69/75), some small-caps return 0 rows
- `liquidity_penalty` hardcoded to 0 (data provider migration incomplete)

---

## Universe

75 tickers in the growth bucket (screened by `run_growth_scan.mjs`). Alt data covers ~92%. Config maps for Wikipedia and GDELT are in `trading/nowcast/config/`.

---

## npm scripts

```bash
npm start                         # full pipeline run
npm run dashboard                 # start dashboard server only (port 5180)
npm run trading:earnings:history  # seed/refresh PEAD earnings outcomes CSV
npm run trading:earnings:drift    # run PEAD drift lab analysis only
npm run trading:regime            # regime model only
npm run trading:backtest          # backtest only
npm run trading:governance        # governance checks only
```

Run from `C:\Users\Theodore\OneDrive\Documents\Playground\`.
Or double-click `launch-dashboard.bat` for the guided menu.

---

## Pipeline execution order (run_alpha_pipeline.mjs)

1. `run_growth_scan.mjs` — screen universe
2. `build_event_data.mjs` — earnings calendar + news (Finnhub)
3. `build_earnings_history.mjs` — PEAD historical returns
4. `build_direct_alt_sources.mjs` — Wikipedia + GDELT (slow, ~10 min)
5. `build_market_proxy_sources.mjs`
6. `run_alt_nowcast.mjs`
7. `run_risk_board.mjs`, `run_crypto_alerts.mjs`, `run_daily_market_context.mjs`
8. Alpha scoring: quality, growth, alt_momentum, peer_relative, proxy_inferred, value, PEAD
9. `run_regime_model.mjs`, `run_signal_quality.mjs`, `run_portfolio_constructor.mjs`
10. `run_daily_top5.mjs`, `run_execution_playbook.mjs`, `run_execution_simulator.mjs`
11. `run_forward_monitor.mjs`, `run_benchmark_returns.mjs`, `run_alpha_backtest.mjs`
12. `run_governance_checks.mjs`, `run_model_scorecard.mjs`
13. `generate_dashboard_data.mjs` — writes `dashboard_data.json`

---

## Known bugs / open work

- [ ] **liquidity_penalty** hardcoded to 0 — needs real volume/spread data
- [ ] **champion/challenger backtest** shows identical results — governance comparison not differentiating
- [ ] **MTX Wikipedia** only returns 1 row (wrong page mapping?)
- [ ] **PEAD date approximation** — using quarter-end + 35 days; would be more precise with SEC EDGAR filing dates or a dedicated earnings announcement calendar API
- [ ] **Scheduled daily run** — not yet set up; Theodore wants 24/7 operation

## Planned signals (not yet implemented)

- **Prediction markets** (Kalshi/Polymarket API → LLM → stock ideas)
- **Baltic Dry Index** as macro regime input (free via FRED API: `DBDE`)
- **ArXiv research agent** — cross-domain strategy papers → signal ideas
- **Ship/AIS alt data** — vessel traffic as economic activity proxy
- **Live Alpaca trading** — when signals are validated via paper trading

---

## Engineering conventions

- All modules export `run()` and check `process.env.TRADING_EMBEDDED !== '1'` before auto-running
- ESM throughout (`.mjs` files, `"type": "module"` in package.json)
- Shared utilities: `trading/scripts/lib.mjs` (parseCsv, toCsv, readCsv, readJson, asNum, toCsv, latestFile, todayDate, ensureDir)
- Timeouts: use `AbortSignal.timeout(ms)` on all fetch calls — Wikipedia 10s, GDELT 20s, Finnhub 12-15s
- Error handling: never let a single-ticker failure kill the full loop — wrap in try/catch, log, continue
- Config: always read from JSON files in `trading/config/` rather than hardcoding values
- New factors go through: raw value → normalizeScores() → _norm → score → weighted into final_alpha_score → added to featureHeaders

## Sub-agent strategy

When spawning sub-agents for this project:
- Give each sub-agent a copy of this CLAUDE.md context
- Typical split: one agent for data fetch/investigation, one for code changes, one for testing
- All file writes go to the same Playground directory — coordinate to avoid concurrent writes to the same CSV
