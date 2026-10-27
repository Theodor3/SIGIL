# Independent SPY data and trend review — October 27, 2026

Read-only review of the downloaded snapshot and evaluator, with a separate reference calculation. No broker access or trades.

## Data checks

- 2,512 rows, October 27, 2016 through October 26, 2026. Raw Yahoo timestamp, close and adjusted-close arrays have matching counts.
- No duplicate dates, nonpositive prices, weekend rows, or gaps longer than four calendar days. This is not a complete exchange-calendar reconciliation.
- Raw SHA-256 matches the public snapshot manifest: 01e5f7e10542a8299d5369dc37b22a7eb9c624f64c9ef5004306c09451df6a33.
- Adjusted-close/close ratio ranges from 0.853995 to 1.0, without downward changes greater than 0.00001. Large observed daily returns on March 12/13/16/24, 2020 and April 9, 2025 were retained, not winsorized.
- Yahoo's last daily timestamp is October 26, 13:30 UTC: a session-start label, not a publication or close timestamp. The October 27 retrieval and October 26 cutoff avoid the current incomplete session.
- Current-vintage provider data is not archived point-in-time data. Corporate actions, reinvestment assumptions, exchange completeness and executable close prices are not independently reconciled.

## Engine review

Reviewed trendStrategy.ts and its 11 tests. No material correctness issue found in warmup exclusion, prior-observation signal, next-close execution, pre-trade interval returns, compounding transaction costs, terminal liquidation, or common benchmark window. An independent calculation matches reported real-data metrics within floating-point tolerance. Terminal-date new entries are intentionally suppressed; existing positions liquidate. The 2023+ window is a retrospective chronological slice, not an untouched holdout.

## Independent comparison

All cases assume 10 basis points per stock purchase/sale, zero cash yield, no tax and provider adjusted-close return ratios. Full window starts August 15, 2017 after warmup and ends October 26, 2026; later window starts January 3, 2023. Figures are percentages.

| Window | Candidate | Net total return | CAGR | Maximum drawdown |
| --- | --- | ---: | ---: | ---: |
| Full | SPY 200-observation trend | 137.0133 | 9.8378 | 24.9684 |
| Full | SPY buy-and-hold | 257.4062 | 14.8549 | 33.7173 |
| Full | Initial 70% SPY / 30% cash, no rebalance | 180.1843 | 11.8546 | 25.9758 |
| 2023+ | SPY 200-observation trend | 66.0830 | 14.2383 | 12.1516 |
| 2023+ | SPY buy-and-hold | 110.2899 | 21.5360 | 18.7552 |
| 2023+ | Initial 70% SPY / 30% cash, no rebalance | 77.2029 | 16.1975 | 14.8943 |

The 70/30 comparator allocates 0.7 * 0.999 to SPY at entry and keeps 0.3 cash; ending SPY value pays 0.001 liquidation cost. It does not rebalance. Its SPY weight drifts and is not a constant-weight or equal-risk baseline. Allocation was fixed at the coordinator's request, not fitted to the trend results.

Conclusion: trend reduced historical drawdown but substantially lagged buy-and-hold return in both windows. The simple initial 70/30 allocation also beat trend return with modestly larger drawdown. These observations do not support calling the candidate a superior or validated strategy.

## Research recommendation

Treat this as a reproducible baseline and preserve the negative result. The immediate advantage over the freight hypothesis is historical testability, not proven profitability. Before increasing complexity, compare a predeclared diversified, unlevered trend/allocation candidate against static diversification, with realistic cash returns and prospective signal receipts. Do not optimize this one sample until it looks attractive.

Primary research motivation: Moskowitz, Ooi and Pedersen's Time Series Momentum studies 58 futures/forward contracts and a 12-month signal; its evidence does not directly validate SPY's 200-day long/cash rule. https://www.aqr.com/Insights/Research/Journal-Article/Time-Series-Momentum

The longer-history multiasset study likewise provides a research rationale, not a transplanted performance claim: https://www.aqr.com/-/media/AQR/Documents/Insights/Journal-Article/AQR-JPM-Fall-2017.pdf
