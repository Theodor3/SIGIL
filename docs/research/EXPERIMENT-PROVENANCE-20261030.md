# Experiment provenance and research tracks — October 30, 2026

## Confirmed defects and scope

Source inspection confirmed date-named context snapshots overwrite on same-day reruns, and evaluator/backtester could enter at the run date close without a recorded decision timestamp. This establishes code risks, not proof that a particular published experiment or portfolio was affected. SignalPrediction has no timestamp column; naive PipelineRun start/end values are not manufactured into decision times. No production service/database was accessed or changed by this work.

## New-run evidence

save_context appends an exclusive UUID/timestamp gzip record and never replaces or automatically prunes historical bytes. Each receipt retains run identity, local aware UTC capture, canonical payload SHA256 and a second hash sealing receipt metadata plus payload. These are local integrity records, not independently authenticated publication timestamps. Source provenance remains aggregate captured context; per-provider original response versions/receipts and cached-input publication times are not implemented. Unknown source timing is explicit. Context is captured before signal execution and llm_focus mutation, so the archive is not claimed to contain later external model activity.

New prediction metadata links that receipt/run/hash and records a conservative aware decision time after signal computation. It is ineligible if a receipt is absent, mismatched, modified, or its availability follows decision. Evaluator resolves actual local immutable receipt UUID and checks its complete metadata/hash; no arbitrary paths are accepted. No DB migration or retroactive timestamps are applied.

## Grading policy

post_decision_daily_v1 measures directional forecast outcomes, not paper executions, portfolio returns, or realized profit. Entry is the first benchmark-calendar close on a New York date strictly after decision; matching stock prices are required. Horizons remain calendar days from the decision NY date, not trading sessions. Require full decision-based maturity, only bars strictly before the current NY date, benchmark coverage through the target period, exact matched endpoints, finite positive stock/SPY prices, and a maximum three-calendar-day stale exit. If a target is a weekend, benchmark confirmation can require an additional completed session. Long holiday closures and incomplete price history can cause conservative abstention. Benchmark data are an observed calendar proxy, not an independent exchange-calendar certification.

No raw-return fallback for a missing benchmark; zero directional alpha is incorrect for both bullish and bearish calls. Date-only compatibility calls return no window. No automatic deletion of preepoch grades or neutral-grade rewriting occurs. Existing rows stay unchanged; new protocol headlines exclude legacy unknown-time generations. This can reduce available headline samples and must not be interpreted as deleted research.

Backtesting requires an explicitly certified deterministic/context-only signal (replay_safe=True); none is automatically certified by registry membership. LLM/wall-clock-dependent replay remains closed. A date with multiple snapshot versions fails closed; an explicit per-run selection interface is a future task. New model studies additionally need captured configuration/model/scaler/training-data versions. Do not blindly enable replay to recover headline numbers.

## Registry/UI

All legacy createdAt values remain unchanged. Calendar dates validate and display as registry dates with unknown time, never fabricated midnight instants or source-publication timestamps. Optional decisionAt and targetAt require canonical timezone-aware instants and ordered future targets. The existing DSM paper forecast receives its exact decision/target from retained prospective-paper-manifest.json; its outcome remains unresolved and source timing flag unchanged. Static snapshot review date is separate from decision and target. Public projection excludes private operational fields.

Three additional registry entries are plans with zero samples, timing unverified and predictive results unavailable:

- DRUG-SUPPLY-DURATION-001: shortage duration until competing supply returns. Audit archived FDA vintages, interval censoring, NDC/ingredient/manufacturer/parent mapping, surviving capacity and contracts. Baselines status-only and prior duration; a complete finite cohort includes resolutions and negative cases. Current FDA state is not a point-in-time history. HHS reconstruction is a research lead; direct NCBI retrieval hit a challenge, not bypassed. https://open.fda.gov/apis/drug/shortages/ and https://www.ncbi.nlm.nih.gov/books/NBK611681/
- PROCUREMENT-REVENUE-001: funded work conversion versus issuer guidance/backlog, stratified by contract type/customer. ICF/HHS is an exposure candidate requiring issuer verification, not a selected investment. Capture first-seen award versions and amendments, exclude ceilings/options from realized revenue and prevent modification double counting. Action dates are not publication dates; delayed disclosure must not be backdated (including the DoD/USACE delay research lead). No award cohort acquired. https://www.sec.gov/Archives/edgar/data/1362004/000119312526082536/icfi-20251231.htm and https://www.usaspending.gov/
- LOCATION-DEMAND-LSTM-001: Starbucks example; distinguish demand, redistribution and comparable-store membership. Public quarterly aggregate comparable transactions are not store-level labels. Historical location membership/geofences and as-delivered traffic vintages remain unverified. Start fixed geography and seasonal/regularized linear baselines with blocked chronological/geographic holdouts; only then consider a multi-horizon LSTM with model/scaler/training hashes. No feed purchase, network fit or performance result. https://investor.starbucks.com/ and https://docs.advanresearch.com/

## Verification and release boundary

96 API/research tests passed in restricted offline read-only Docker, including actual SQLite-in-memory preservation/grading behavior, immutable reruns, tampering, maturity, incomplete stock and benchmark histories, timezone boundaries and replay gating. Seven Node projection tests passed; frontend TypeScript/Vite build passed. Existing bundle-size warning and datetime.utcnow deprecation remain. Astra independently reviewed actual changes, found material timing gaps that were fixed, and reported no remaining blocker in this local scope; Astra did not run tests itself.

No paid model calls, credentials, large/raw datasets, trades, production writes, push or deployment. Source/registry JSON only; data purchases and automatic missions remain outside this change. Review the implications for headline samples, conservative abstention and future immutable storage retention before any deployment.
