# Bounded mission queue

Open `http://127.0.0.1:8765/queue`. The page distinguishes canonical board tasks from ready runtime missions and shows why a prepared mission is unavailable. Historical blocked or terminal work does not refill the queue.

1. Write one focused assignment and acceptance criteria, choose local or API mode, and click **Prepare only**. This records one ready runtime mission and its explicit ready board link. It does not dispatch a worker.
2. Select one to three exact ready mission IDs in the intended order. Local is the default. API sessions require explicit selection and confirmation of spending within the existing allowance. Choose a finite limit of 1–60 minutes and a minimum dispatch interval of 1–60 minutes, then start.
3. Review each result externally. The queue waits before starting the next independent selected mission. An evidence-blocked disposition ends the session. A recorded review/rejection/supersession permits another independent selected task without validating or accepting the preceding artifact.

Stop prevents further dispatch and signals only the session's own active mission. Calls already sent may finish. An unrelated manually started mission is never stopped by the queue. Each mission retains its normal twenty-minute maximum, shortened before launch to the remaining session time. Both elapsed and absolute session bounds are checked. Every session starts through an explicit action; server restart leaves it off. No OS autostart, wake, automatic task creation/refill, terminal replay, provider fallback, automatic acceptance, deployment or trading is added.

Mission specifications and user instructions are frozen when selected. A changed assignment, non-ready board link, stale Studio, missing provider, unavailable required tests, uncertain billing or exhausted API allowance blocks dispatch. Existing API limits, reservations, ledger, store identity and historical costs are used unchanged. A historical attention marker alone does not block unrelated ready work; an unresolved evidence review does.

Preparing work preserves unrelated board fields, checks observed file changes before atomic replacement and keeps an exact original backup. Queue writers cooperate through a lock. This is not a transaction with an arbitrary external editor: a non-cooperating editor can race the final replacement check. A failed board link remains visible and ineligible; refresh before repeating a request whose outcome is uncertain.

Queue events record session IDs, selected mission IDs, bounds and outcomes in the existing Store event log, without copying prompts. Board-task lifecycle review remains explicit; terminal linked runtime missions are not eligible even if an older board entry still says ready.

The queue excludes Claude subscription missions. Their separate per-run authorization and public-packet controls are documented in `CLAUDE-WINDOWS.md`.
