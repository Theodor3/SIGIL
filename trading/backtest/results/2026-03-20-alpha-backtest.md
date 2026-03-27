# Alpha Backtest - 2026-03-20

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 108

## Champion

- Name: Champion v1
- Trades: 36/108 (33.33%)
- Hit rate: 88.89%
- CAGR: 844.34%
- Sharpe: 4.166
- Max drawdown: -7.76%
- Avg trade return (20d): 20.27%
- Avg benchmark return (20d): 2.38%
- Avg alpha per trade: 17.90%

### Champion Alpha Buckets
- Q1: n=9, avg alpha=22.64%, score range=0.540..0.540
- Q2: n=9, avg alpha=9.64%, score range=0.540..0.630
- Q3: n=9, avg alpha=14.98%, score range=0.630..0.708
- Q4: n=9, avg alpha=24.33%, score range=0.708..0.708

## Challenger

- Name: Challenger v1
- Trades: 36/108 (33.33%)
- Hit rate: 88.89%
- CAGR: 844.34%
- Sharpe: 4.166
- Max drawdown: -7.76%
- Avg trade return (20d): 20.27%
- Avg benchmark return (20d): 2.38%
- Avg alpha per trade: 17.90%

### Challenger Alpha Buckets
- Q1: n=9, avg alpha=22.64%, score range=0.501..0.501
- Q2: n=9, avg alpha=31.36%, score range=0.501..0.639
- Q3: n=9, avg alpha=14.33%, score range=0.639..0.678
- Q4: n=9, avg alpha=3.25%, score range=0.678..0.678

## Decision

- Winner: CHAMPION
- Reason: Champion remains better on simulated portfolio returns

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.