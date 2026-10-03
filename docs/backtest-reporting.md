# Backtest reporting version 2

The research backtest reports gross SPY-relative directional forecast alpha,
not portfolio returns. Long alpha is stock return minus SPY return; short
alpha negates that difference. A hit requires strictly positive directional
alpha, so a tie is not a win for either direction.

Both benchmark prices must be available on the actual stock entry and exit
dates, finite and positive. Missing or stale benchmark windows are excluded
from both accuracy and alpha, never graded on raw stock return instead.
`n`, `alpha_n`, and the hit-rate denominator describe the same population.
`eligible_calls` equals `n` plus `skipped_stock_window` plus
`skipped_benchmark_window`. Empty populations return null metrics, not zero.
Nonfinite stock returns count as unusable stock windows.

`round_trip_cost_bps` is optional and must be finite and nonnegative. If
provided, `estimated_net_alpha` subtracts that cost divided by 10,000 from
the unrounded average gross alpha. If omitted, the net estimate is null.
Zero is an explicit zero-cost scenario, not the default assumption. The
caller must include their assumed fees, spread, slippage and any borrow
costs. A constant cost per forecast does not model sizing, overlapping
positions, turnover, capacity, benchmark trading, or actual execution.

The existing calendar-day window selection is retained: delayed entry does
not move the target exit date. Date-only snapshots cannot prove intraday
availability; overlapping forecasts are not independent samples. These
changes do not alter the live evaluator, strategy weights, or trading rules.
Historical live evaluator statistics therefore need not match version 2
backtests, especially for missing benchmarks and zero-alpha shorts.

Validation uses normal imports and synthetic price histories inside the
restricted Studio container, without network access or production data.
