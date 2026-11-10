# GDELT reference implementation

`gdelt_before.py` is the unmodified provider from commit
`41265a2fde07c4fec30c2ed0c14348e5a5e4fe11` (`api/data/gdelt.py`).
It is an offline differential-test reference, not a second production provider.
Line endings may differ from the Git blob.

`tests/test_gdelt_pacing.py` feeds this reference and the optimized provider the
same synthetic HTTP responses. It checks exact request parameters and order,
the 50-query coverage cap, returned fields and order, malformed/empty responses,
timeouts, rate-limit backoff, downstream signals, LLM input prompts, scores,
confidence, eligibility, ranking, and portfolio targets. The simulated-clock
benchmark is not a measured production speedup.
