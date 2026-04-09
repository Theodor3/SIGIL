# Alpha Backtest - 2026-04-04

- Threshold: 0.5
- Hold days: 20
- Benchmark mode: QQQ
- Min sample for promotion: 20
- Matched events: 374
- Models tested: 1 champion + 2 challengers

## Champion

- Name: Alpha V1
- Trades: 126/374 (33.69%)
- Hit rate: 76.19%
- CAGR: 2312.22%
- Sharpe: 2.030
- Max drawdown: -85.27%
- Avg trade return (20d): 10.06%
- Avg benchmark return (20d): 2.00%
- Avg alpha per trade: 8.07%

### Champion Alpha Buckets
- Q1: n=32, avg alpha=1.28%, score range=-0.005..0.221
- Q2: n=32, avg alpha=4.02%, score range=0.221..0.305
- Q3: n=32, avg alpha=11.47%, score range=0.305..0.418
- Q4: n=30, avg alpha=16.00%, score range=0.418..0.591

## Challenger: Alpha V1 Regime Tilt

- Name: Alpha V1 Regime Tilt
- Trades: 126/374 (33.69%)
- Hit rate: 76.19%
- CAGR: 1907.00%
- Sharpe: 1.945
- Max drawdown: -85.44%
- Avg trade return (20d): 9.52%
- Avg benchmark return (20d): 2.03%
- Avg alpha per trade: 7.50%

### Challenger: Alpha V1 Regime Tilt Alpha Buckets
- Q1: n=32, avg alpha=1.28%, score range=-0.028..0.160
- Q2: n=32, avg alpha=9.26%, score range=0.160..0.337
- Q3: n=32, avg alpha=12.19%, score range=0.337..0.409
- Q4: n=30, avg alpha=7.24%, score range=0.409..0.658

## Challenger: Alpha V1 Quality Heavy

- Name: Alpha V1 Quality Heavy
- Trades: 126/374 (33.69%)
- Hit rate: 76.19%
- CAGR: 2668.54%
- Sharpe: 2.037
- Max drawdown: -85.27%
- Avg trade return (20d): 10.54%
- Avg benchmark return (20d): 2.00%
- Avg alpha per trade: 8.54%

### Challenger: Alpha V1 Quality Heavy Alpha Buckets
- Q1: n=32, avg alpha=1.28%, score range=-0.012..0.244
- Q2: n=32, avg alpha=5.36%, score range=0.244..0.325
- Q3: n=32, avg alpha=11.16%, score range=0.325..0.445
- Q4: n=30, avg alpha=16.91%, score range=0.445..0.541

## Decision

- Winner: CHALLENGER
- Reason: Alpha V1 Quality Heavy has higher simulated CAGR on matched out-of-sample events

## Notes

- Uses event-based out-of-sample simulation with configurable hold period.
- If benchmark_returns.csv is absent, benchmark falls back to cross-sectional proxy.