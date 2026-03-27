# Alpha Backtest - 2026-03-25

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 120

## Champion

- Name: Champion v1
- Trades: 12/120 (10.00%)
- Hit rate: 83.33%
- CAGR: 35.33%
- Sharpe: 4.544
- Max drawdown: -3.94%
- Avg trade return (20d): 7.30%
- Avg benchmark return (20d): 1.68%
- Avg alpha per trade: 5.62%

### Champion Alpha Buckets
- Q1: n=3, avg alpha=12.71%, score range=0.630..0.630
- Q2: n=3, avg alpha=4.16%, score range=0.630..0.630
- Q3: n=3, avg alpha=6.50%, score range=0.630..0.630
- Q4: n=3, avg alpha=-0.90%, score range=0.630..0.630

## Challenger

- Name: Challenger v1
- Trades: 12/120 (10.00%)
- Hit rate: 83.33%
- CAGR: 35.33%
- Sharpe: 4.544
- Max drawdown: -3.94%
- Avg trade return (20d): 7.30%
- Avg benchmark return (20d): 1.68%
- Avg alpha per trade: 5.62%

### Challenger Alpha Buckets
- Q1: n=3, avg alpha=12.71%, score range=0.674..0.674
- Q2: n=3, avg alpha=4.16%, score range=0.674..0.674
- Q3: n=3, avg alpha=6.50%, score range=0.674..0.674
- Q4: n=3, avg alpha=-0.90%, score range=0.674..0.674

## Decision

- Winner: CHAMPION
- Reason: Champion remains better on simulated portfolio returns

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.