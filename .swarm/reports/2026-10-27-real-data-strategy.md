# Real-data experiment 02 — fixed trend screen

Design recorded October 27, 2026 before reviewing performance results. This is a project design record, not independently timestamped preregistration.

Question: Can a simple broad-market trend rule reduce drawdown enough to justify the missed upside and extra costs relative to buy-and-hold?

Universe: SPY only, selected in advance as a broad-market ETF. It avoids making freight conditions a presumed stock predictor. This is an adaptation of established trend-following research, not a new discovery.

Rule: compare adjusted close with its trailing 200 observed closes. Strictly above = long; otherwise cash. Signal at close t, rebalance at next observed close t+1, earning the prior allocation's intervening return first. No leverage or shorting. Cash return zero. Ten basis points per entry/exit, including final liquidation. Benchmark uses identical window and entry/exit cost. No parameter optimization. Later 2023+ chronological slice is a retrospective robustness view, not an untouched holdout. Current-vintage adjusted prices are a total-return proxy, not actual executable prices or a dividend cash ledger.

Record CAGR, total return, maximum drawdown, exposure and trade transitions. Keep negative findings. A return shortfall is not hidden by a smaller drawdown. Next candidate should only be chosen after this screen, with explicit experiment count and a genuinely prospective period.

Sources:
- https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=10y&interval=1d
- https://mebfaber.com/2009/02/19/a-quantitative-approach-to-tactical-asset-allocation-updated/ (background motivation; this daily rule is not an exact replication)
- https://www.stb.gov/reports-data/rail-service-data/ (freight receipt only)

Data receipts in .swarm/reports/market-data preserve raw bytes, retrieval time and SHA256. SPY snapshot has 2,512 rows from 2016-10-27 through 2026-10-26. CSX October21 workbook is preserved; its original posting timestamp remains unknown, so it is not backdated into trading signals.

Results: full-window trend CAGR9.84%, maxDD24.97%; SPYbuyhold14.85%,33.72%. An exploratory initial70/30stock-cash comparator added after first results (not fitted weights) returned11.85%,maxDD25.98%; no rebalance. Later2023slice preserves the lowerreturn/lowerdrawdown pattern. No superior strategy established.13trend/passive tests and14freight regression checks pass; frontendbuild passes. Independent reference calculation matches. Browser periodtoggle and fullinput/result export verified. Next bounded taskSTRATEGY004 is diversified design, not automatic tuning.
