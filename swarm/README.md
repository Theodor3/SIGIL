# SIGIL swarm workspace

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

Each worker gets two rounds of up to three tools, and retains all six results. Shared outcomes and source links reach the reviewer and coordinator. Complete latest research documents and draft diffs remain in review context; an oversized prompt stops instead of silently dropping documents.

Per mission: at most 32 tool attempts, eight drafts, two web searches, four paper searches, six page fetches and two isolated test requests. Legacy `source_requests` also allow up to eight retrieved pages. Search rejects recognizable credentials, local paths and copied source lines. Queries must use public concepts. Retrieval proves access, not the truth of a model's interpretation. No PDF extraction or market-data subscription is included.

Snapshots are fixed when the service starts. Commit reviewed changes and restart to expose a new version. Readiness blocks new paid work when the served snapshot is older than the branch head. Missions already pinned to an older commit require a new mission. Historical records retain their original commit; the file browser identifies the current snapshot.

## Isolated Python tests

Tests use a pinned local image ID, no network or host mounts, a read-only root filesystem, a non-root user, dropped capabilities, and bounded resources, output and time. Sanitized source and draft text enter through standard input. There is no unrestricted shell, broker or deployment tool. A branch alone is not execution isolation.

Docker was unavailable during installation. Windows denied starting its service, so actual agent code execution is blocked. Read/search/draft/syntax work independently. Once the owner starts Docker Desktop with Linux containers, prepare the trusted image from this checkout:

```powershell
docker --context desktop-linux build -f swarm/Dockerfile.tests -t sigil-swarm-tests:pilot .
```

The image installs only Python and pytest. Tests needing other dependencies fail explicitly. Agents cannot install packages or access live services. The runner never builds/pulls images automatically; it checks local image availability when requested. Container behavior has mock-based tests; an actual run still needs verification once Docker is available.

## Budget and persistence

The allowance is **$1 per America/New_York calendar day and $7 total, expiring September 11, 2026**. One mission can run at a time, with at most two fixed specialists, an automatic independent reviewer, five assignment rounds, two peer-revision rounds and twenty active minutes. Revision and peer requests cannot silently add roles. Completed, stopped and interrupted API missions are immutable; additional work starts as a focused mission so paid calls are not replayed.

The supervised hourly Codex coordinator is active. It checks readiness first, reviews existing work, and may create at most one narrow mission. It stays idle while keys are disconnected or another blocker is present. This schedule runs only while the local host and Codex are available; it does not make the computer an always-on server.

Reservations precede every model/search request. Standard input/output estimates per million tokens are Gemini $0.25/$1.50, coordinator $4/$20, and search utility $0.40/$1.60. Search adds $0.01 per tool call and a conservative 8,000-input-token content allowance. Each search reserves $0.45 for an upper bound and releases the unused allowance; a reservation is not a charge. Rates checked September 4 against [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI pricing](https://developers.openai.com/api/docs/pricing) and [GPT-4.1 Mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

The preserved runtime ledger currently records Gemini usage of **$0.140585**, OpenAI coordination/search of **$0.471891**, total **$0.612476**. The dashboard separates providers and shows every mission's reservations, returned model, token usage, estimated cost and error state. Runtime records remain authoritative. These are local estimates, not invoices or account-wide caps; caching, search accounting, billing, taxes and unrelated usage can differ.

SDK retries are disabled. Missing usage, unexpected model identity, uncertain failures and interrupted reservations retain their allowance and block further live work pending reconciliation. Version 0.3 stores missions, events and calls in `.swarm/runtime/swarm.sqlite3` with WAL journaling, foreign keys and a persistent store identity. On first launch it checksums and retains the legacy JSON files before importing them once. Preserve the canonical runtime directory; one controller owns it. Restarts retain records, lose submitted keys and do not resume missions automatically.

The service binds only to 127.0.0.1 and has no multiuser authentication. Keep it local. SIGIL's production services and trading scheduler are not started; research does not automatically change trading strategies.

## Validation

Run `python -m pytest swarm/tests -q`. The version-0.3 upgrade passes 74 offline checks covering budget concurrency and SQLite migration, real SDK serialization with mock responses, Gemini model/schema handling, fixed mission membership, peer delivery, private/public tool separation, pinned snapshots, secret/symlink exclusions, draft integrity, isolated container commands, deadlines, timeout/startup failures, readiness and worker tool-result delivery.

The first live mission verified worker/coordinator models and usage. The later Studio pilot verified file reads, code search, one cited search call, draft storage and matching syntax checks; it ended for review and did not validate a trading signal. The next supervised cycle should be one narrow two-specialist research mission after reconnecting keys. Actual container execution requires separate verification once Docker and the image are available.
