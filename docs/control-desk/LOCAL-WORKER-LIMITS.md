# Local worker limits and measured run — October30,2026

Recent failures were distinct: the local assignment store rejected input above2,000characters; one generated artifact failed its16,000character schema boundary. Neither was proof that the loaded model context was exhausted. Local output remains subject to a separate token ceiling and structured-schema validation.

| Layer | Before | After |
| --- | --- | --- |
| Local mission/assignment/UI input |2,000characters|6,000characters|
| Local artifact_body |16,000characters|32,000characters|
| Local response timeout |240seconds|480seconds|
| Local summary |6,000characters|unchanged|
| Output token request |8,192tokens|unchanged|
| Serialized system/prompt/schema guard |85,000UTF8bytes|unchanged|
| HTTP body |24,000bytes|unchanged|
| Paid Assignment / subscription prompt |2,000characters|unchanged|

LocalAssignment isolates the expanded packet contract; paid/subscription schemas, budget, providers, credentials, scheduling and container isolation are unchanged. No slicing was introduced. Oversized schema output or incomplete/token-limited generation remains an explicit failure, never accepted as a complete artifact. Output tokens may exhaust before32,000characters; this is not a32,000character generation guarantee. The byte guard is not an exact tokenizer/context-fit guarantee, and Unicode JSON overhead can hit the HTTP body boundary before6,000characters. Loaded-context resizing or general saturation testing was not performed.

Hardware observed: RTX4070TiSUPER,16,376MiB,14,407–14,410MiB in use before the representative run. LM Studio reports sigil-local,Google Gemma4,Q4_0,loaded_context_length32,768,model maximum262,144. The maximum is not the actual loaded context. No model reload/GPU/context setting change was made given existing memory use.

Twenty-four synthetic regression tests passed only in restricted offline Docker. They include6,000/6,001input boundaries, preserving paid/subscription limits, exact32,000/32,001output boundaries,28,000character storage roundtrip, redacted overflow failure and an engine test checking complete long mission text in both local contexts. Test harness creates a synthetic Git fixture inside Docker tmpfs because Windows worktree .git pointers cannot resolve inside Linux. No host Python synthetic tests.

Supported idle-only dashboard launcher restart loaded a five-file focused patch over preserved canonical user changes; affected source backups retained locally. Canonical store store_4b6c94a3538f4cb4 and existing allowance preserved. Paid providers reloaded from the previously authorized environment opt-in; readiness verification reset naturally and no paid authentication call was made.

Real supervised mission m_17f6a4eb6db94110 received4,373characters, including all45corn/Tyson episode rows and beginning/ending markers. sigil-local worker and separate-context critic both completed:8,981input/520outputtokens in18.82s, then7,318input/1,100outputtokens in31.38s. Approximately50.5seconds total. Critic retained both packet markers; worker did not follow that instruction. Model results support this representative packet, not all possible maximum inputs. Output artifacts294/3,152characters did not exercise the new output boundary; the28,000character synthetic persistence test covers that boundary separately.

Twenty-one GPU samples during the run observed maximum14,410MiB and83%utilization, no reported OOM; sampled peak is not continuous hardware telemetry. No paid model calls: API cost$0,electricity/subscription usage not measured. Full receipts/artifacts/GPUCSV remain in the local research lab outside the repository.

Research quality remains separate from capacity. The followup hypothesizes hedging/pass-through as counterarguments but did not retrieve supporting contract/hedging records, omitted requested annual counts and proposed an underpowered24month quarterly-margin study without a precise baseline. Do not accept it as a ready experiment or validated mechanism. Earlier fixed corn/Tyson test remains negative; do not reverse its sign or claim alpha from a larger context.
