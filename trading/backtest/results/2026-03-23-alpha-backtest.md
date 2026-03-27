# Alpha Backtest - 2026-03-23

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 108

## Champion

- Name: Champion v1
- Trades: 36/108 (33.33%)
- Hit rate: 83.33%
- CAGR: 376.24%
- Sharpe: 2.972
- Max drawdown: -7.76%
- Avg trade return (20d): 14.54%
- Avg benchmark return (20d): 1.83%
- Avg alpha per trade: 12.71%

### Champion Alpha Buckets
- Q1: n=9, avg alpha=6.35%, score range=0.503..0.503
- Q2: n=9, avg alpha=5.17%, score range=0.503..0.640
- Q3: n=9, avg alpha=14.98%, score range=0.640..0.727
- Q4: n=9, avg alpha=24.33%, score range=0.727..0.727

## Challenger

- Name: Challenger v1
- Trades: 24/108 (22.22%)
- Hit rate: 83.33%
- CAGR: 294.44%
- Sharpe: 3.404
- Max drawdown: -7.76%
- Avg trade return (20d): 18.89%
- Avg benchmark return (20d): 2.04%
- Avg alpha per trade: 16.85%

### Challenger Alpha Buckets
- Q1: n=6, avg alpha=41.02%, score range=0.658..0.658
- Q2: n=6, avg alpha=15.14%, score range=0.658..0.658
- Q3: n=6, avg alpha=8.44%, score range=0.687..0.687
- Q4: n=6, avg alpha=2.80%, score range=0.687..0.687

## Decision

- Winner: CHALLENGER
- Reason: Tie on CAGR, higher average trade return

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.