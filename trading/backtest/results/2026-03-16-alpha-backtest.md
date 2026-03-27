# Alpha Backtest - 2026-03-16

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 108

## Champion

- Name: Champion v1
- Trades: 24/108 (22.22%)
- Hit rate: 83.33%
- CAGR: 294.44%
- Sharpe: 3.404
- Max drawdown: -7.76%
- Avg trade return (20d): 18.89%
- Avg benchmark return (20d): 2.04%
- Avg alpha per trade: 16.85%

### Champion Alpha Buckets
- Q1: n=6, avg alpha=8.44%, score range=0.640..0.640
- Q2: n=6, avg alpha=2.80%, score range=0.640..0.640
- Q3: n=6, avg alpha=41.02%, score range=0.723..0.723
- Q4: n=6, avg alpha=15.14%, score range=0.723..0.723

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
- Q1: n=6, avg alpha=41.02%, score range=0.653..0.653
- Q2: n=6, avg alpha=15.14%, score range=0.653..0.653
- Q3: n=6, avg alpha=8.44%, score range=0.688..0.688
- Q4: n=6, avg alpha=2.80%, score range=0.688..0.688

## Decision

- Winner: CHAMPION
- Reason: Champion remains better on simulated portfolio returns

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.