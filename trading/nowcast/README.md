# Alternative Data Earnings Nowcast Pipeline

Run:

```bash
node trading/nowcast/run_alt_nowcast.mjs
```

Inputs (CSV in `trading/data/alt/`):

- `website_traffic.csv` -> `date,ticker,value`
- `app_rank.csv` -> `date,ticker,value`
- `search_trends.csv` -> `date,ticker,value`
- `price_promo.csv` -> `date,ticker,value`
- `foot_traffic.csv` -> `date,ticker,value`
- `consensus_estimates.csv` -> `ticker,report_date,consensus_revenue_growth_yoy,consensus_revenue_surprise_pct,consensus_eps_surprise_pct`
- `earnings_calendar.csv` -> `ticker,report_date`
- `earnings_outcomes.csv` -> `ticker,report_date,revenue_surprise_pct,post_earnings_return_5d`
- `us_holidays.csv` -> `holiday_date,holiday_name`

Config:

- `trading/nowcast/config/model_config.json`
- `trading/nowcast/config/peer_groups.json`

Output:

- `trading/output/YYYY-MM-DD-alt-nowcast-top20.csv`
- `trading/output/YYYY-MM-DD-alt-nowcast-top20.md`

Pipeline steps implemented:

1. Ingest multi-source alternative data per ticker.
2. Seasonality normalization via YoY baselines + holiday-window dampening.
3. Peer-group relative comparisons per source.
4. Feature engineering (YoY, acceleration, z-score, relative strength).
5. Revenue surprise nowcast + post-earnings outperformance probability.
6. Rank top names by deviation vs consensus * confidence.
7. Historical setup backtest summary from outcomes file.

