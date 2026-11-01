# SIGIL swarm workspace

## Current development round (September 28)

The owner renewed paid development with a $100 total ceiling. The one-time `POST /api/budget/authorize-development` action records this authorization and retains every prior call and charge. Historical usage counts toward the ceiling; a $20 daily throttle and October 28 expiry further bound work. Repeating this action never resets usage or extends the expiry. These are application estimates, not account-wide provider billing limits.

Docker execution uses the deliberately audited local image ID pinned in `swarm/studio.py`. The runner remains non-root, without host/socket mounts or network, with a read-only root and resource bounds. Read the isolated-test section before restoring or replacing the image. Capability is checked on this machine; historical verification is not a guarantee of current availability.

The paid coordinator already delegates bounded assignments to at most two specialist roles plus a reviewer. It cannot create unlimited recursive workers. The paused local heartbeat is not a paid scheduler; paid jobs are currently supervised. Bionic integration remains unverified.

## Local workers (v0.4)

Local worker mode runs one selected data, engineering, quant, or operations role on this PC, followed by a separate-context critique using the same model. It ends in `needs_review`; a human or Codex coordinator must assess the evidence. Drafts are never applied automatically. This is a separate mode from the expired paid pilot documented below.

Start the existing runtime with `lms server start --bind 127.0.0.1 --port 1234`, then load the downloaded model with `lms load google/gemma-4-26b-a4b-qat --context-length 32768 --parallel 1 --identifier sigil-local --yes`. Start the dashboard with the checked launcher. Choose **Local worker**, select a role, and submit an assignment of at most 6,000 characters. State the exact source files and acceptance criteria.

Only the localhost endpoint is used; proxy inheritance, redirects, cloud fallback and automatic retries are disabled. Each mission is limited to one specialist plus critique, two tool rounds per role, twelve recorded calls, and twenty minutes. Local missions can use free Crossref paper search (four attempts) and approved public HTTPS page retrieval (six attempts), including STB and CSX. Paid general web search remains disabled. After private source access, outbound research is blocked; page text is untrusted evidence, not instructions. Reports retain fetched URLs, timestamps and hashes and require external review. The paid budget, expiration and ledger remain intact. Zero API cost excludes electricity. Model identity, usage, tool records and report provenance are retained in the same store.

The dashboard offers explicitly started finite queue sessions over one to three ready missions. Sessions remain off after every restart and wait for external review between missions. See [QUEUE.md](QUEUE.md); no work is created or refilled automatically. Closing the server or sleeping the computer stops availability; interrupted missions are preserved and never automatically replayed. Bionic can use local models interactively, but this integration dispatches through LM Studio's API rather than automating Bionic chats.

Historical pilot notes below describe the earlier cloud run, including its old scheduler and spending snapshot; `.swarm/company.json` and the runtime ledger contain the later pilot closure.

Seven Gemini specialist roles and one OpenAI coordinator work through a local dashboard. Missions produce research, directed peer messages, source records and proposed changes. Studio shows what the team inspected, drafted and checked.

## Start

Run `outputs/sigil-swarm/Start Swarm.ps1` from the Codex handoff, or the versioned `swarm/scripts/Start Swarm.ps1` in this checkout, and open <http://127.0.0.1:8765/>. The launcher validates the served checkout, version, process identity and Studio commit before it reports ready. Use its `-Status` or `-Restart` switch for a checked status or safe restart. Rebuild the Python 3.11+ environment with `swarm/requirements.txt` if necessary.

1. Enter both keys in **API connections**. They remain in server memory until restart/disconnection. The app never saves them or reads SIGIL's `.env`. Environment keys are ignored unless the owner deliberately starts the process with `SIGIL_SWARM_ALLOW_ENV_KEYS=1`.
2. Open **Studio** to browse the pinned source snapshot.
3. Create a narrow **API mode** mission and start it. Only relevant roles run. The saved **Sample mode** mission is scripted and costs nothing.
4. Send follow-ups to a specialist or coordinator. **Stop** prevents further dispatch; calls already sent may finish and be charged.

Configured means a key was entered. Verified means a successful response was received in the current session. Gemini `gemini-3.1-flash-lite` and coordinator `gpt-5.6-sol` both returned verified responses in the first live mission. The earlier Gemini HTTP 400 was corrected with `response_json_schema`; model metadata is checked before planning. Unsupported accounts stop instead of silently switching worker models.

## Studio and tools

A mission pins a full Git commit. The snapshot includes tracked, bounded text; it withholds working-copy changes, hidden files, known credential literals, binary files and oversized files.

| Tool | Behavior |
| --- | --- |
| `read_file`, `search_code` | Read/search pinned source without reading untracked data, live credentials or the main checkout. |
| `draft_file` | Engineering/quant save proposed full-file replacements with diffs and original hashes. Drafts do not change the checkout. |
| `check_syntax` | Parse Python/JSON drafts without importing or executing them. Other formats are explicitly not checked. |
| `run_tests` | Fixed pytest command in an isolated local container, when available. Exact draft IDs and hashes are recorded. |
| `web_search` | GPT-4.1 Mini search utility through the existing OpenAI key, with citations, model identity and a separate ledger entry. |
| `paper_search` | Crossref scholarly metadata search with no model/API fee. Metadata is not a full-paper review. |
| `fetch_page` | Public HTML/text/JSON from approved research and developer-documentation domains; bounded retrieval, checked redirects and no private addresses. |

Each worker gets two rounds of up to three requested tools and retains the results. Paths named explicitly in a source-inspection assignment are loaded automatically before the first response. Exact read ranges, file hashes, commit and bounded source text remain available to that worker across revisions and to the reviewer and coordinator. Source-grounded artifacts use structured claim-to-read IDs: the controller validates visibility, paths, ranges, lowercase SHA-256 values and the pinned commit, then renders the evidence itself. Invalid links cause the claimed body to be withheld. Complete latest research documents and draft diffs remain in review context; an oversized prompt stops instead of silently dropping documents.

Per mission: at most 32 tool attempts, eight drafts, two web searches, four paper searches, six page fetches and two isolated test requests. Legacy `source_requests` accept only approved public HTTPS pages; Studio paths are rejected with instructions to use `read_file`. Artifact citations are retained only when their URL has a retrieved-page record; web-search snippets and paper metadata remain leads until the page is fetched. Search rejects recognizable credentials, local paths and copied source lines. Queries must use public concepts. Retrieval proves access, not the truth of a model's interpretation. No PDF extraction or market-data subscription is included.

Snapshots are fixed when the service starts. Commit reviewed changes and restart to expose a new version. Readiness blocks new paid work when the served snapshot is older than the branch head. Missions already pinned to an older commit require a new mission. Historical records retain their original commit; the file browser identifies the current snapshot.

## Isolated Python tests

Tests use a pinned local image ID, no network or host mounts, a read-only root filesystem, a non-root user, dropped capabilities, and bounded resources, output and time. Sanitized source and draft text enter through standard input. There is no unrestricted shell, broker or deployment tool. A branch alone is not execution isolation.

Start Docker Desktop with Linux containers and inspect the exact `TEST_IMAGE` ID from `swarm/studio.py`. The runtime never builds or pulls automatically. A missing image keeps Python execution unavailable; do not substitute host execution.

For a deliberate image-maintenance change, build a candidate from the pinned recipe, inspect its resulting immutable local ID and review the dependency set:

```powershell
docker --context desktop-linux build -f swarm/Dockerfile.tests -t sigil-swarm-tests:candidate .
docker --context desktop-linux image inspect sigil-swarm-tests:candidate --format '{{.Id}}'
```

A rebuilt tag normally has a different local image ID. It does not automatically satisfy the existing pin. After the candidate image and dependencies are reviewed, update `TEST_IMAGE` to that exact inspected ID in a reviewed source change and run the isolated runner tests plus a real restricted-container probe. Record the source commit, image ID, results and restrictions before accepting the replacement. Do not weaken isolation or silently switch to a mutable tag. To keep the existing pin, transfer the identical audited image through an approved artifact workflow; a source rebuild alone is not guaranteed to reproduce its local ID.

The recipe declares the available test dependencies. Missing dependencies fail explicitly and require deliberate image maintenance. Agents cannot install packages or access live services. Tests and supplied packets use synthetic fixtures; passing them does not establish a trading signal or historical data availability.

## Budget and persistence

The allowance is **$1 per America/New_York calendar day and $7 total, expiring September 11, 2026**. One mission can run at a time, with at most two fixed specialists, an automatic independent reviewer, five assignment rounds and twenty active minutes. Mission creation can lower the revision allowance through the validated `max_revisions` field; prompt prose cannot expand it. Specialists run in parallel by default or in a declared sequence when one depends on another's evidence. Revision and peer requests cannot silently add roles. Completed, stopped and interrupted API missions are immutable; additional work starts as a focused mission so paid calls are not replayed.

The supervised daily Codex coordinator is active. It checks readiness first, reviews existing work, and may create at most one narrow mission. It stays idle while keys are disconnected or another blocker is present. This schedule runs only while the local host and Codex are available; it does not make the computer an always-on server.

Reservations precede every model/search request. Standard input/output estimates per million tokens are Gemini $0.25/$1.50, coordinator $4/$20, and search utility $0.40/$1.60. Search adds $0.01 per tool call and a conservative 8,000-input-token content allowance. Each search reserves $0.45 for an upper bound and releases the unused allowance; a reservation is not a charge. Rates checked September 4 against [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and [GPT-4.1 Mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

The preserved runtime ledger currently records Gemini usage of **$0.205938**, OpenAI coordination/search of **$0.750599**, total **$0.956537**. The dashboard separates providers and shows every mission's reservations, returned model, token usage, estimated cost and error state. Runtime records remain authoritative. These are local estimates, not invoices or account-wide caps; caching, search accounting, billing, taxes and unrelated usage can differ.

SDK retries are disabled. Missing usage, unexpected model identity, uncertain failures and interrupted reservations retain their allowance and block further live work pending reconciliation. Version 0.3.2 stores missions, events and calls in `.swarm/runtime/swarm.sqlite3` with WAL journaling, foreign keys and a persistent store identity. On first launch it checksums and retains the legacy JSON files before importing them once. Preserve the canonical runtime directory; one controller owns it. Restarts retain records, lose submitted keys and do not resume missions automatically.

The service binds only to 127.0.0.1 and has no multiuser authentication. Keep it local. SIGIL's production services and trading scheduler are not started; research does not automatically change trading strategies.

## Validation

Run `python -m pytest swarm/tests -q`. Version 0.3.2 passes 122 offline checks covering budget concurrency and SQLite migration, real SDK serialization with mock responses, Gemini model/schema handling, fixed mission membership, structured revision limits, ordered peer handoffs, exact reviewer source evidence, structured claim binding, malformed and cross-role evidence rejection, initial-reviewer isolation, retrieval-backed citations, private/public tool separation, pinned snapshots, secret/symlink exclusions, draft integrity, isolated container commands, deadlines, timeout/startup failures, readiness, and launcher/application version agreement.

The September 5 S006 cycle exposed missing read evidence and an unenforced prose revision limit; version 0.3.1 corrected those controls. S009 then completed all nine assigned reads and substantively established that the inspected EDGAR path exposes filing dates/forms and discrete flags but not Item 1A text, accession IDs or an SEC acceptance/public-availability timestamp. Its final free-form matrix still truncated hashes and failed its evidence contract, so the controller blocked it after exactly one revision. Version 0.3.2 replaces copied provenance with structured claim-to-read bindings rendered by the controller, verifies them again when stored, supports complete multi-chunk coverage, rejects truncated context, and prevents the initial reviewerâ€™s messages, sources, and tools from preloading specialist work. New dashboard missions default to one revision. Five redundant administrative follow-ups were closed after spending $0.606306, and the scheduled coordinator now refuses summary-derived follow-up chains. No signal was validated. Actual container execution requires separate verification once Docker and the image are available.

### September 29 development trial

Gemini workers now request gemini-3.1-pro-preview with low thinking and an 8192-token generation limit. Reservations retain the full 65536-token output allowance. Standard text rates are $2/M input and $12/M output including thinking, for prompts below 200k tokens; the controller input bound remains below that tier. Source: https://ai.google.dev/gemini-api/docs/pricing (checked September 29). Historical ledger costs are retained.

Small changes can use `draft_edit` with one exact, unique source fragment. Coding missions can require Docker readiness with `requires_tests`. After a safe restart, `python -m swarm.connect_session --env-file <owner-env-file>` connects only the two provider keys to the verified, idle loopback dashboard without logging or copying them. Unattended dispatch remains paused pending successful coding acceptance.


## Current finite authorization controls

[CLAUDE-WINDOWS.md](CLAUDE-WINDOWS.md) documents read-only auth diagnostics and explicit per-run launch/stop timestamps. Login does not prove billing settings or renew a generation window. Subscription receipts stay separate from API-dollar estimates.

The owner-approved research allowance is an idempotent $20 new-usage authorization with no automatic refill; activation retains historical spend, reservations and the existing daily throttle. New API missions default to a $2 estimate cap, which counts held and settled calls from both providers. Local remains the default queue mode and cannot fall back to paid providers. Role/complexity routing and the selected model/rate are recorded on each API call. Starting the server or preparing a mission does not dispatch a paid call.
