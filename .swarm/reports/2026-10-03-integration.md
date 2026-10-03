# October 3 integration

The coordinator integrated DEV007's accepted SEC future-date guard without
altering the historical mission. Current source hashes matched the accepted
draft's base. The unchanged implementation failed four future-date cases;
the accepted draft passed all 20 tests. Local commit: a9b4ab5.

Docker listed the trusted image but failed to resolve its tag, while lookup
by image ID succeeded. Reattaching the existing tag restored lookup. This
establishes the immediate failure mode, not the cause of Docker's inconsistent
tag state. Do not automatically pull or rebuild on a readiness failure.
Inspect the approved image ID, restore its tag deliberately, and rerun the
isolation probe. A newly built image also needs the probe.

The trusted image was extended with pinned SQLAlchemy, SQLite driver and
Pydantic dependencies to import the real backtester and evaluator in tests.
The actual isolation probe passed before execution. Current verified image:
sha256:688217aaad6af2a2eff707678122129ccc6ded952610e8a236827ad527968662.

Coordinator-authored backtest changes require matching benchmark dates,
report missing populations explicitly, treat unavailable metrics as null,
grade zero-alpha calls consistently, and support optional assumed costs.
The Signal Lab reflects the semantics and removes unsupported timing claims.
See docs/backtest-reporting.md for the contract and limitations.

Validation: 39 application tests passed inside Studio (20 SEC, 19 backtest),
plus the isolation probe. The backtest tests fail against the original
implementation (18 failed, 1 passed). Exact hashes and outputs are in the
adjacent JSON reports. Frontend TypeScript and Vite build passed. Installation
reported 11 dependency advisories and the build reported a large bundle;
dependency upgrades and bundle splitting were not part of this change.

No provider calls, paid missions, live market queries, trading, push or deploy.
The branch remains local. Recurring dispatch remains off. Refreshing the
dashboard after commits clears session-only provider keys; future missions
must satisfy readiness again. Next proposed work is a fresh source/data audit
of the two signal versions flagged in the September weekly review, without
assuming that the old report proves causation or changing live weights.
