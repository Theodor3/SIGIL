# Alpha Backtest - 2026-04-02

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 374

## Champion

- Name: Champion v1
- Trades: 24/374 (6.42%)
- Hit rate: 83.33%
- CAGR: 294.44%
- Sharpe: 3.404
- Max drawdown: -7.76%
- Avg trade return (20d): 18.89%
- Avg benchmark return (20d): 2.04%
- Avg alpha per trade: 16.85%

### Champion Alpha Buckets
- Q1: n=6, avg alpha=41.02%, score range=0.546..0.546
- Q2: n=6, avg alpha=15.14%, score range=0.546..0.546
- Q3: n=6, avg alpha=8.44%, score range=0.690..0.690
- Q4: n=6, avg alpha=2.80%, score range=0.690..0.690

## Challenger

- Name: Challenger v1
- Trades: 20/374 (5.35%)
- Hit rate: 70.00%
- CAGR: 21.83%
- Sharpe: 1.127
- Max drawdown: -41.67%
- Avg trade return (20d): 3.79%
- Avg benchmark return (20d): 1.65%
- Avg alpha per trade: 2.14%

### Challenger Alpha Buckets
- Q1: n=5, avg alpha=-7.91%, score range=0.501..0.507
- Q2: n=5, avg alpha=7.98%, score range=0.507..0.740
- Q3: n=5, avg alpha=4.09%, score range=0.740..0.740
- Q4: n=5, avg alpha=4.40%, score range=0.740..0.740

## Decision

- Winner: CHAMPION
- Reason: Champion remains better on simulated portfolio returns

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.