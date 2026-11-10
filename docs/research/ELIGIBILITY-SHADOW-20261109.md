# Offline eligibility shadow comparison, 2026-11-09

## Decision summary

The correction can materially change target composition even when every final score is unchanged. Keep eligibility changes separate from the deployed display-only work until a strategy decision is made. These examples establish possibility, not real-world frequency, improvement, or return performance.

## Scope and reproducibility

No production source was changed. The baseline is the exact original scorer from Git commit 26531a3, frozen at tests/shadow_fixtures/baseline_scorer_26531a3.py (Git blob e4a0c73922d1aba29172fb82dbfe666fcacb6193). A test verifies its bytes. Candidate scorer and unchanged portfolio constructor come from e6ebec6, the branch base. The display-only deployed work was supplied as unchanged scorer semantics; no live deployment or live accounts were queried here.

Both scorer modules use the same current api/config/alpha_model.json. No caller weight overrides. Configured active value weight is 0.30 * 1.2 / 5.8 = 0.0620689655; disabled alt_momentum weight is zero. Gate is 0.58. Regime factor tilts are all 1 by default, and gross exposure is fixed at 1. No regime comparison is mixed into this experiment.

The retained-input search was deliberately limited to the Git-tracked sanitized snapshot: no complete historical multi-signal scorer inputs were identified. The only tracked CSV was the BEA research matrix, not scorer replay inputs. Tests and retained score summaries are not complete historical raw signal data. No live database, secrets, account positions, or exports were read. This does not assert that no complete inputs exist elsewhere.

Synthetic fixture version 1 is the deterministic synthetic_inputs function in tests/test_eligibility_shadow.py. All SYNTH_nn names and FictionalSector_n sectors are fictional. It creates 24 names, or 16 in capacity_loss, scored 0.95 - 0.015*i on value, with disabled signal score 0.5. Names are evenly assigned to five fictional sectors by i modulo 5. Only two signals are present per name, intentionally exposing sparse active/disabled confidence disagreement. This is not representative market calibration.

All cases use the unmodified PortfolioConstraints defaults: 20 positions maximum, 8% maximum per position, 2% minimum position, 30% maximum sector, long-only. Both books are asserted to obey the position and sector caps. No permissive one-stock caps, prices, share rounding, holdings, account equity, or broker services are used.

## Results

- Control: 24 names have active and disabled confidence 0.8. Eligibility remains 24/24; top-20 targets remain identical. No adds, removals, reweights, cash change, or turnover.
- Mixed flips: names 00-03 have active/disabled confidence 0.4/1.0, so original average 0.7 passes but corrected 0.4 fails. Names 04-07 have 0.9/0.1, so original average 0.5 fails but corrected 0.9 passes. Remaining names have 0.8/0.8. Eligibility stays 20 of 24 but four identities change. Targets remove 00-03 and add 04-07; all 16 retained targets reweight. Both books remain fully invested. Equity L1 target change is 48.84792627%; one-way target turnover including cash is 24.42396313%.
- Capacity loss: 16 names, with 00-03 at 0.4/1.0 and the rest at 0.8/0.8. Eligibility and targets fall from 16 to 12. Four names are removed, none added, and all 12 retained names rise to the 8% position cap. Cash rises from 0% to 4%. Equity L1 change is 51.37313433%; one-way turnover including cash is 27.68656716%.

Maximum final-score difference is exactly zero in every case. The corrected averaging population, not a score change, drives these eligibility and allocation changes.

Full per-name target weights and exact unrounded metrics are in ELIGIBILITY-SHADOW-20261109-results.json.

## Metric meaning and limitations

Equity L1 = sum over the union of names of abs(candidate target weight - baseline target weight). Cash = 1 - sum(equity target weights). One-way target turnover including cash = 0.5 * (equity L1 + abs(candidate cash - baseline cash)). These are hypothetical target-book differences, before any regime scaling (here fixed to 1), not executed turnover or an order plan. Costs, market impact, hysteresis, existing holdings, execution turnover limits, prices, missing quotes, share rounding and fills are deliberately outside scope. No expected-return, realized-return, alpha, or performance claim follows from these numbers. Three designed cases do not estimate the incidence of eligibility changes on retained or live data.

## Validation evidence

Pinned test commit: 33eb5ef6fad7c557c87d9f10b160f07f46c034d1. Focused tests: 4 passed, 3 intentional result-reporting warnings. Full application tests target `tests`: 243 passed, 11 warnings (3 result warnings and 8 existing datetime deprecations). All project Python execution took place only in the trusted GitStudio restricted Docker runner using image sha256:c2ddeeec7f32f1717584654d6a4cbc20ee2b454cad49a2fefd911d2cff8bed9d, network disabled, read-only root, nonroot user, no capabilities, bounded resources. Host Python only orchestrated that runner. No API calls or spend, orders, broker access, push, or deployment.

Source line ranges, complete-file SHA256 hashes, and pinned commit from GitStudio reads are recorded in ELIGIBILITY-SHADOW-20261109-sources.json. Reproduce by invoking trusted GitStudio at the pinned test commit, run_tests([], "tests/test_eligibility_shadow.py") or run_tests([], "tests"); tests emit full comparison JSON in their warning summary. Do not execute project tests on the host.
