# STRATEGY005 independent review — October 27, 2026

Disposition: accounting implementation accepted for retrospective research. Candidate fails its predeclared performance screen; no superior strategy established. No implementation or trading authority is inferred from this review.

## Data integrity

All five downloaded Yahoo responses (SPY, EFA, IEF, GLD, BIL) match their recorded SHA256 hashes. Every one of the 2,512 dates and adjusted-close values per ETF matches its raw response; no mappings were inferred, filled or dropped. Coverage is October 27, 2016 through October 26, 2026. Dates are aligned, without duplicates or weekend rows; maximum observed calendar gap is four days.

This verifies the downloaded bytes and mapping, not the accuracy of Yahoo's corporate-action adjustments, exchange-calendar completeness, historical availability or executable prices. Provider daily timestamps label sessions, not original publication times. The October26 cutoff excludes the current incomplete October27 session. BIL is a traded Treasury-bill ETF proxy; adjusted returns must not receive an extra interest credit.

## Independent accounting check

Reviewed web/src/lib/diversifiedStrategy.ts. The implementation uses prior completed-month observations, a full 200-observation warmup, and execution at the following supplied close. Old holdings earn the interval return before rebalancing. Each of four sleeves retains its fixed25% target or assigns that sleeve to BIL. Both portfolios pay on actual buys and sells, including BIL, monthly drift rebalancing, and terminal liquidation. The benchmark uses identical dates and the same four ETFs, with equal weights monthly. No material accounting issue was found.

The engine solves post-cost capital by bisection. A separate Node reference implementation used iterative fee fixed-point convergence and independently constructed holdings and equity. All full/recent10bps and25bps results match within floating-point tolerance. Twelve evaluator tests passed when independently rerun, including lagged execution, self-financing costs, BIL returns, drift, future-data invariance and validation.

## Results

Full evaluation: September1,2017 through October26,2026;110 monthly rebalances. Later evaluation: January3,2023 through October26,2026;46 rebalances. Both are retrospective, not untouched holdouts. CAGR and drawdown figures are percentages.

| Window / cost each side | Trend CAGR | Static CAGR | Trend max drawdown | Static max drawdown |
| --- | ---: | ---: | ---: | ---: |
| Full /10bps |6.6180|9.3563|11.3321|19.7038|
|2023+ /10bps |11.3532|15.4301|8.9962|8.9962|
| Full /25bps |5.9886|9.2753|12.5268|19.7362|
|2023+ /25bps |10.7364|15.2983|9.0030|9.0030|

At10bps the candidate's full-window drawdown is about42.49% smaller, but its annualized return trails by2.7383 percentage points. The predefined allowable shortfall was1 percentage point. Therefore the screen FAILS. Later-period maximum drawdowns are effectively equal; comparisons should allow tiny numerical tolerance, not an economic relaxation.

Full-window cumulative fees are4.5283% of initial capital for trend versus0.6898% for static. These are summed cash charges in initial-capital units, not annual fees or a simple subtraction from terminal gross return. Gross normalized turnover totals36.0882 versus4.5182, including initial and final trades.

## Interpretation and limits

The test supports a historical drawdown/return trade-off, not a better strategy under its own acceptance criterion. Static diversification already offers substantial protection. Frequent sleeve switching and missed recovery exposure can make the trend overlay expensive. Preserve this failure rather than adjust the window, universe or cutoff until it passes.

No prospective paper trial has been activated. The proposed October30 decision and subsequent12-month observation period remain a design only. Current-vintage adjusted prices, retrospective universe choice, one decade of history, fractional holdings, omitted taxes and simplified10/25bps cost assumptions limit inference. No independent corporate-action cash ledger or full market-calendar reconciliation was performed.
