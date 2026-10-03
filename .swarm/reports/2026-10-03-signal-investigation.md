# Signal investigation — October 3, 2026

## Verdict

Confirmed implementation and data-contract defects; insufficient evidence to
attribute the observed performance difference to the 1.0 → 1.1 rewrite.
No weight change, version rollback or production action is justified by this
investigation alone. One narrow tested fix is prepared locally.

## Fresh evidence

Read-only GET /api/agent/review?days=7 returned generated_at
2026-10-03T09:25:17Z. Signal statistics explicitly have all-time scope;
they are not this week's returns and are not portfolio returns.

| Current version 1.1 | 5-calendar-day alpha | 20-calendar-day alpha | 60-calendar-day alpha |
|---|---:|---:|---:|
| debt_distress | -0.2169% (n=26,357) | -0.4999% (n=24,800) | -2.2092% (n=14,237) |
| earnings_miss_risk | -0.1915% (n=26,026) | -0.4022% (n=24,467) | -2.0960% (n=14,078) |

Prior version 1.0's 20-day alpha is +0.9153% for debt_distress (n=6,781)
and +0.9840% for earnings_miss_risk (n=6,920). These are different cohorts,
not paired predictions over identical dates/tickers. The endpoint supplies
neither cohort date ranges nor raw matched observations or data coverage.
Overlapping observations also prevent treating n as independent evidence.

The live evaluator still counts correctness for observations with missing
alpha while averaging alpha only over present values, and substitutes zero
when all alpha is unavailable. The earlier local backtest fix does not alter
that production evaluator. This further limits interpretation of the export.

## Corrected interpretation

Both signals compute score=1-penalties. A score near 1 means low assessed
risk, not severe distress or a strong earnings-miss warning. High values on
losing positions do not identify the signals as causes of those losses.
The September report's attribution was stronger than its evidence supported.

## Findings and disposition

1. **Zero EPS bounds: confirmed code defect, fixed locally.** The truthiness
   check skips an EPS range when a bound is zero. For low=0, high=2, avg=1,
   version 1.1 produces score 1.0 instead of the existing formula's 0.8.
   Explicit None checks preserve valid zero bounds and retain avg>0.
   Version is bumped to 1.2 so future evaluation does not mix changed logic.
   Three synthetic cases fail on the old implementation; all 16 input tests
   and the full 55-test application suite pass with the patch. One synthetic
   high=0 case intentionally characterizes current handling of an inconsistent
   range; validating range ordering is outside this narrowly scoped fix.

2. **PEG mapped to forward P/E: confirmed data-contract defect, not fixed in
   this signal patch.** api/data/fmp.py assigns priceToEarningsGrowthRatioTTM
   to forward_pe. A synthetic provider response reproduces PEG 1.5 becoming
   forward_pe 1.5. api/pipeline/runner.py's nonzero FMP values overwrite Yahoo
   values for that key. This can distort both valuation thresholds and the
   trailing/forward ratio. Provider documentation distinguishes PEG fields:
   https://site.financialmodelingprep.com/es/developer/docs/stable/metrics-ratios-ttm
   and defines PEG in https://site.financialmodelingprep.com/de/faqs?code=analyst
   (retrieved October 3). Live affected frequency and downstream performance
   are unmeasured. Repair needs a separate adapter/merge contract, dependent
   signal versioning and historical cache treatment; silently relabeling old
   snapshots would corrupt the evidence.

3. **Negative equity treatment changed: confirmed behavior, policy unresolved.**
   Git commit 837a89d (July 1) removed the old positive-debt/nonpositive-equity
   penalty branch and switched to provider debt_to_equity thresholds. Negative
   ratios do not trigger those positive thresholds. A negative ratio alone is
   not sufficient to select a new penalty without validating numerator,
   denominator, sector and source semantics. Other penalties may still fire;
   the worker's blanket claim that these companies receive unpenalized scores
   is too broad.

4. **Missing fields can look low-risk: characterized, not attributed to rewrite.**
   Empty fundamentals produce neutral/no-confidence output, but a nonempty
   dictionary containing only market_cap produces score 1 with confidence
   in both signals. The no-penalty branch also existed in 1.0. A documented
   minimum-data policy is needed before changing this behavior.

## Swarm and validation limits

DEV009 m_cdcfb405a40e4213 ran one bounded API mission. Engineer and initial
independent reviewer produced source-linked findings. Quant failed with
Gemini HTTP 400 before returning an artifact. No automatic retry or second
mission was started; the terminal record remains blocked. The reviewer did
not validate the final code patch. Codex performed the numerical analysis,
source/diff review and synthetic regression validation separately.

Mission estimate $0.122668; cumulative ledger $2.303630, reserved $0,
uncertain billing false. Docker's tag lookup inconsistency recurred; the
previously verified image ID was retagged and the isolation probe passed.
See adjacent risk-input-tests and fmp-mapping-audit JSON for source hashes,
recorded reads, synthetic drafts, exact container image and outputs.

## Preregistered next comparison

Freeze the code and an approved sanitized archive of dated contexts. Replay
1.0 and 1.1 on identical ticker/date pairs with the same matched price windows,
calendar horizons, benchmark policy and explicit cost scenario. Report paired
score/direction changes, data coverage, eligible and excluded populations,
gross and net alpha by version. Separate signal-code changes from provider
input fixes; list every tested variant. Use a chronological holdout and
date-block uncertainty estimates for overlapping observations. A regression
claim requires an adverse paired effect that survives reasonable cost and
coverage checks; absent matched data, retain an insufficient-evidence verdict.
The current read-only endpoint cannot supply this dataset, and no raw live
database or account positions were copied. Repair the PEG/forward-P/E contract
before trusting a broad reweighting experiment. Gemini request diagnostics
also need repair before another paid multi-role mission.
