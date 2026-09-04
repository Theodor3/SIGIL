# SIGIL browser pilot audit — September 4, 2026

## Current operational state

The hourly coordinator automation is PAUSED while the user and coordinator redesign the team around APIs and direct, recorded collaboration. No new worker assignments were dispatched during this audit.

Six existing worker conversations were inspected through their rendered pages. The product/operations conversation had been closed; reopening its recorded URL reached Google's unusual-traffic verification page. That challenge was not solved or bypassed. The earlier O001 report remains summarized in FIRST-CYCLE.md; it was not freshly rechecked.

The local development branch remains codex/sigil-company. Before this planning update its only additional commit was 5b9013a, containing operating instructions, prompts, board, roster and initial review. No application feature or validated trading signal had been produced by the pilot.

## Chat findings

| Worker | Fresh observation | Assessment |
|---|---|---|
| [Corporate events](https://gemini.google.com/app/f88cb33ffe5c4dfd) | R003 explicitly retracted R001's exact return estimates and forecast Sharpe ranges. It corrected the year shift in its proposed calendar formula. | Correction is useful but source acceptance remains incomplete. One source URL is displayed as suspicious link removed; the report still calls source verification complete. Its statement about immediate SEC publication conflicts with D001's statement about delayed dissemination. Neither assertion is accepted without checking applicable SEC rules. |
| [Frontier research](https://gemini.google.com/app/3942745fbe3e1a18) | One original proposal covering procurement protests and customer-supplier overreaction; no peer follow-up. | Hypotheses only. Procurement/business outcomes do not establish tradable equity returns. Published paper, sample, historical access and incremental value need verification. |
| [Data](https://gemini.google.com/app/bf7ceeb0f2940af5) | One original data matrix, including precise SEC/N-PORT timing claims and absolute coverage claims. | Required data questions are identified, but current rules, source provenance, coverage and publication times need primary-source checks. It has not collaborated directly with the event researcher. |
| [Quant](https://gemini.google.com/app/b4dda4d556451002) | One original protocol proposal remains. | Still overstates conditional concerns as confirmed defects and suggests unvalidated fixed fees and numeric gates. It has not received the reviewer's correction as shared context. |
| [Engineering](https://gemini.google.com/app/25f44458dc7fad2d) | One original additive cost-screening proposal remains. | A useful design candidate, not a patch or tested implementation. It includes unsupported universal cost and borrow assumptions. No direct engineer-reviewer exchange has occurred. |
| [Independent review](https://gemini.google.com/app/f7f4cf2c667590f9) | V002 corrected the account-equity versus individual-stock Sharpe error and distinguishes calendar semantics from bugs. It raised unit, day-count and missing-sample comparability checks. | Improved, but it still lacks direct source/test access. New claims about funding asymmetry need scope-specific assessment. The page now reports a limit reached and continuing with Flash-Lite. The exact model that generated each historical reply is not independently established by the current picker. |
| [Product/operations](https://gemini.google.com/app/ac7ff9577e1c2c40) | Fresh navigation blocked by a Google traffic check. | Prior proposal only: retain traceability and result labels; reject arbitrary rejection quotas, invented saved-capital metrics and unapproved spending/production authority. |

## What this pilot established

- Separate specialist prompts can produce useful questions and candidate plans.
- Follow-up criticism can cause corrections and explicit retractions.
- The current browser implementation has no worker-to-worker mailbox, durable execution engine, source-verification gate or sandboxed code worker.
- Inter-agent handoffs currently depend on the GPT coordinator manually reading and relaying selected text.
- Browser quota/model fallback and verification challenges make browser sessions unsuitable as the planned unattended execution mechanism.
- The roster and board were already stale: R003 and V002 were marked assigned/working despite completed replies.
- Model statements such as completed, verified and no blockers cannot serve as authoritative task status.

## Consequences for the API design

Use explicit task dependencies, durable messages, artifacts tied to exact code/data versions, independently checked evidence, provider-returned model/usage records, and observed test results. API access improves control and observability; it does not make unsupported model claims true. Keep seven roles and prove one complete collaboration loop before enabling recurring project changes.
