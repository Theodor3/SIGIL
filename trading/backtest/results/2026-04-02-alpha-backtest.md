# Alpha Backtest - 2026-04-02

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 415

## Champion

- Name: Champion v1
- Trades: 24/415 (5.78%)
- Hit rate: 83.33%
- CAGR: 294.44%
- Sharpe: 3.404
- Max drawdown: -7.76%
- Avg trade return (20d): 18.89%
- Avg benchmark return (20d): 2.04%
- Avg alpha per trade: 16.85%

### Champion Alpha Buckets
- Q1: n=6, avg alpha=41.02%, score range=0.545..0.545
- Q2: n=6, avg alpha=15.14%, score range=0.545..0.545
- Q3: n=6, avg alpha=8.44%, score range=0.688..0.688
- Q4: n=6, avg alpha=2.80%, score range=0.688..0.688

## Challenger

- Name: Challenger v1
- Trades: 16/415 (3.86%)
- Hit rate: 87.50%
- CAGR: 90.67%
- Sharpe: 2.978
- Max drawdown: -3.94%
- Avg trade return (20d): 13.95%
- Avg benchmark return (20d): 1.67%
- Avg alpha per trade: 12.29%

### Challenger Alpha Buckets
- Q1: n=4, avg alpha=32.29%, score range=0.509..0.509
- Q2: n=4, avg alpha=9.83%, score range=0.739..0.739
- Q3: n=4, avg alpha=2.55%, score range=0.739..0.739
- Q4: n=4, avg alpha=4.47%, score range=0.739..0.739

## Decision

- Winner: CHAMPION
- Reason: Champion remains better on simulated portfolio returns

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.