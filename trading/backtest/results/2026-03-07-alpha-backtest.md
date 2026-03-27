# Alpha Backtest - 2026-03-07

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 108

## Champion

- Name: Champion v1
- Trades: 12/108 (11.11%)
- Hit rate: 83.33%
- CAGR: 27.23%
- Sharpe: 5.194
- Max drawdown: 0.00%
- Avg trade return (20d): 5.84%
- Avg benchmark return (20d): 1.42%
- Avg alpha per trade: 4.42%

### Champion Alpha Buckets
- Q1: n=3, avg alpha=4.85%, score range=0.816..0.816
- Q2: n=3, avg alpha=5.95%, score range=0.816..0.816
- Q3: n=3, avg alpha=8.24%, score range=0.816..0.816
- Q4: n=3, avg alpha=-1.36%, score range=0.816..0.816

## Challenger

- Name: Challenger v1
- Trades: 12/108 (11.11%)
- Hit rate: 83.33%
- CAGR: 27.23%
- Sharpe: 5.194
- Max drawdown: 0.00%
- Avg trade return (20d): 5.84%
- Avg benchmark return (20d): 1.42%
- Avg alpha per trade: 4.42%

### Challenger Alpha Buckets
- Q1: n=3, avg alpha=4.85%, score range=0.737..0.737
- Q2: n=3, avg alpha=5.95%, score range=0.737..0.737
- Q3: n=3, avg alpha=8.24%, score range=0.737..0.737
- Q4: n=3, avg alpha=-1.36%, score range=0.737..0.737

## Decision

- Winner: CHAMPION
- Reason: Champion remains better on simulated portfolio returns

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.