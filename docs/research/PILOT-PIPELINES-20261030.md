# Manual investment pilot pipelines — October 30, 2026

These Python modules are local research tools, not production signals. They import no broker, register no scheduler and make no provider calls on import. Nothing is pushed/deployed. The existing registry now describes actual small captures and remaining gates, with predictive results false.

## Runnable code

`api/research/pilots/receipts.py` provides fixed public-source requests, 30-second/1MB bounds, no redirects/retries/credentials, exact raw bytes, SHA256-sealed receipt metadata and exclusive immutable files. Reimporting the identical capture is idempotent; later fetch times/changed payloads retain versions. Raw data belongs in a separately chosen private local directory, never in the repository. Publication time stays null; available_at is the actual retained local response receipt. This is local evidence, not an independently attested clock or historical public archive.

`supply_procurement.py` normalizes observed identities and retains statuses and dates without converting them to historical availability. `observed_panel` preserves every version and earliest retained local observation separately, using aware-instant ordering. Absence from a partial next page is not resolution. Current cumulative award amounts cannot become obligation flows/revenue. All issuer mappings are unverified; names are not identity/ownership proof. Duration uses a Kaplan-Meier baseline only with reviewed onset/follow-up timestamps and available labels, distinguishes reported resolution from unknown censoring, and refuses unsupported horizons. Conversion uses preavailable matched revenue/incremental funded-obligation labels, stratified by issuer/customer/contract type; it cannot fit the current award snapshots. Both propagate fixture/real evidence kind and reject mixing.

`location.py` implements persistence, same-month seasonal and fixed-ridge linear baselines before any neural model. Named features, label definitions/units and geography/comparable-membership versions must match. Every historical feature has its own pre-period decision boundary; training labels and target features must be available strictly before the current decision. Scaling is fit on training only; training/model/scaler hashes are retained. It does not read target labels. No geographic pooling, parameter search, random split, network download or LSTM fit occurs. Seasonal missing history and insufficient/absent training abstain. A future geographic model requires a predeclared aggregation/held-out geography design; current scaffolding operates within one fixed unit.

Verified-label flags are caller assertions requiring independent source review; these functions do not authenticate a vendor feed or establish an edge. Kaplan-Meier additionally assumes appropriate cohort/censoring conditions. Fixture outputs are synthetic, not empirical forecasts.

From repository root, using the existing Python environment:

```powershell
python -m api.research.pilots capture fda --out C:\PRIVATE_LOCAL_DATA\sigil-pilots
python -m api.research.pilots capture procurement --out C:\PRIVATE_LOCAL_DATA\sigil-pilots
python -m api.research.pilots normalize RECEIPT_SHA256 --out C:\PRIVATE_LOCAL_DATA\sigil-pilots
python -m api.research.pilots observed-panel fda --out C:\PRIVATE_LOCAL_DATA\sigil-pilots
python -m api.research.pilots duration-baseline docs/research/pilot-examples/duration-empty.json
python -m api.research.pilots conversion-baseline docs/research/pilot-examples/conversion-empty.json
python -m api.research.pilots location-baseline docs/research/pilot-examples/location-empty-synthetic.json
```

The example packets intentionally contain no real labels and return blocked/no-fit results. Synthetic training examples exist only in regression tests, run under restricted Docker. Capture is manual and limited to one five-row page; the procurement query is an all-time ICF-keyword/HHS top-award preview, not a complete or issuer-verified study cohort. No missing cohort members or cancellations may be inferred from this preview.

## Actual data acquired, outside Git

Local receipts and raw bytes are under the task's `investment-pilot-data` directory, about0.72MB original payload total. Imports were run against the real bytes; no new fetch was needed to normalize them.

- **openFDA** `https://api.fda.gov/drug/shortages.json?limit=5`: HTTP200,8,815bytes, captured2026-10-30T19:38:06.699975UTC, rawSHA `f456cbd7e1e3a99af221e30816a72838ec20f0ae62c845993687ad6ff3732912`. Five records from reported population1,614. One Current row says Available; one Resolved row has no verified restoration timestamp. Censoring remains unknown and zero duration episodes qualify. API current-state response succeeded even though documentation retrieval returned403; no restriction was bypassed. Historical vintages, onset/follow-up and competing-capacity/contract/parent mapping remain missing.
- **USAspending** POST `https://api.usaspending.gov/api/v2/search/spending_by_award/`: HTTP200,2,435bytes,captured19:38:44.135875UTC, rawSHA `b76b9d9320455603515bc0dd5010b5db25323fa064ff09de66659f6715770206`. Five top award-search rows include FAMILY ENDEAVORS and four ICF-named recipients. All remain mapping-unverified and excluded from issuer features/totals; the keyword alone is not entity evidence. Current amounts and old start/end dates are not first-seen funding flows. Zero verified conversion labels qualify. Need UEI/DUNS plus historical parent mapping, dated transaction revisions and matched revenue/guidance/backlog labels. Public API docs: https://api.usaspending.gov/docs/endpoints .
- **Starbucks official Q4FY2025 release**: HTTP200,702,276bytes,captured19:46:03.141950UTC,rawSHA `c609c16bb8677164f0032bf21e2460a80fbc55b25d72e3ad70609379f016aaec`. PrintedOctober29,2025; quarterendedSeptember28,2025. Verified an aggregate NorthAmerica/US comparable-transaction decline clause; this is one issuer document and zero store-level training labels, not a prospective historical vintage. https://investor.starbucks.com/news/financial-releases/news-details/2025/Starbucks-Reports-Q4-and-Full-Fiscal-Year-2025-Results/ . Actual store/traffic labels, historical membership, geographic vintages and suitable independent time span remain unavailable. No licensed feed purchased.

All actual baseline outcomes are blocked/no-fit, not negative economic results: no valid duration episodes, no matched conversion labels and no location training panel. No investment returns or alpha were computed. The useful result is a tested capture/validation path and concrete source/mapping failures.

## Local worker, review and tests

Actual local mission `m_7e9674f8b2114889` ran two calls through `sigil-local`; LMStudio metadata identifies GoogleGemma4 26BA4BQAT Q4_0,32,768context. DATA6,116input/535output; same-modelcritic5,737input/460output. Model API cost$0, electricity excluded. The worker gave Markdown instead of required indexed JSON; critic caught the contract failure but its own artifact was incomplete. Original artifacts are retained and disposition rejected. Broad valid caveats were independently checked; this is not independent local-model validation.

Astra's Codex collaboration independently reviewed actual source hashes/code. It found incorrect censoring, unsupported survival extrapolation, missing fixture provenance and lexical timezone ordering; all were fixed with regressions. Astra did not run tests itself. Regression tests cover receipt integrity/idempotence/versioning, source/query bounds, partial samples, unresolved censoring, supported survival, mapping/flow gates, feature/label availability, historical feature decisions, fixture separation and train-only scaling. Existing frontend export/build checks remain required for the updated registry.

No paid model calls, credential/billing changes, data purchases, real orders, automatic jobs, push or deployment. API allowance remains the existing ledger; no new allowance created. Before any empirical test, obtain the missing reviewed labels and freeze a finite cohort, baseline/evaluation policy and chronological holdout.

Final verification:117 API/research tests passed in restricted offline Docker (21pilot tests included),seven Node registry/export tests passed,and frontend TypeScript/Vite build passed. Existing datetime.utcnow deprecation and bundle-size warnings remain. The empty-label baseline CLI was actually run under restricted Docker and returned blocked/no-fit. Live completion check at2026-10-30T19:52:19UTC: idle,scheduleroff,APIallowanceused$1.976436,remaining$18.023564,reserved$0. No paid model calls in this development round.
