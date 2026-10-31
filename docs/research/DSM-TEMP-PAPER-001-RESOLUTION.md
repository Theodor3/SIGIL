# KDSM paper forecast: resolved October 30, 2026

The event **temperature at least 15 C** resolved true under the unchanged frozen rule. For the 22:00 UTC target, the unique nearest qualifying observation was **KDSM at 21:54 UTC: 15 C, QC V**, six minutes before target. The retained historical window also contains 21:45 (15 C) and 22:15 (14 C). The latest feed had advanced to 22:40; pagination reached older observations, with no conflicting duplicates.

| Frozen forecast | Probability | Brier error | Absolute temperature error |
| --- | ---: | ---: | ---: |
| NWS hourly grid | 42.65418943% | 0.328854198975 | 0.555556 C |
| Persistence | 90.87887803% | 0.008319486604 | 4 C |

Persistence had the lower Brier error for this binary event; NWS had the lower point-temperature error. Both probabilities use an arbitrary, uncalibrated normal residual with sigma 3 C. Neither is an official NWS exceedance probability. One weather case establishes no general skill, investment alpha or profit.

The outcome was appended locally at **23:01:48.715784 UTC**, using official observations retained as of **23:00:53.773393 UTC**. Later source revisions or backfills remain possible. The original October 29 decision, forecast records, target, plan and raw forecast inputs remain unchanged. A consistent backup preceded the two append-only outcomes; SQLite integrity passed. Astra independently checked source hashes, selection and arithmetic. Six isolated selection tests and seven registry/export tests passed.

The [official historical window](https://api.weather.gov/stations/KDSM/observations?start=2026-10-30T21:40:00Z&end=2026-10-30T22:20:00Z) was retained with SHA-256 `914544fb30c18605d885e6a6421ee2656f031b90a50d05348bcf3d87b59c17b6`. Exact receipts, source bytes, ledger and backups remain local outside Git. The original manifest retains its registration-time unresolved status as historical evidence; the ledger and final-resolution companion hold the current outcome.

The local experiment registry and snapshot now contain this result. Nothing was pushed or deployed. No trades, paid model calls or automatic jobs were started.
