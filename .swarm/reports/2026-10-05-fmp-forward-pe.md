# FMP forward P/E mapping correction — October 5, 2026

DEV016 (m_72b24f94cbe24aef) completed nine calls, estimated $0.359270, but exhausted its single round without an accepted deliverable. Its reviewer artifact was withheld for invalid source references; the coordinator identified missing regression cases and incomplete consumer coverage. No replay was started. Codex independently inspected the adapter and all forward_pe matches.

Changed api/data/fmp.py to emit None for forward_pe. priceToEarningsGrowthRatioTTM is not used as forward P/E, and no substitute provider field is invented. Existing pipeline merging first fills from Yahoo, then overlays non-null FMP extra_keys: missing FMP forward_pe therefore preserves the Yahoo value. FMP-only records retain an explicit missing value.

Consumers: accounting_red_flags and earnings_miss_risk guard the optional field and skip P/E gap/valuation penalties when absent. forward_value does not consume fundamentals.forward_pe: it derives price / estimated_eps_avg, so that signal remains unchanged. Existing no-penalty outputs label risk low even with incomplete inputs; this separate missing-data policy is unchanged, not validated by this correction.

110 tests passed in GitStudio's isolated Docker runner, including eight regression cases covering realistic/missing/invalid PEG values, preserved trailing P/E, both risk consumers and independent forward-value calculation. Exact tested drafts and image are in the conversation workspace outputs/fmp-forward-pe-tests.json. No live data calls, pipeline execution, historical data rewriting, trading changes or deployment. Historical cached/saved metrics are not retroactively repaired. Local-only correction awaits authorized release.
