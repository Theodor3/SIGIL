# SIGIL swarm workspace

A local dashboard for seven Gemini specialist roles and one OpenAI coordinator. Give the team a mission, address questions to a specialist, inspect peer requests and challenges, and download the conversation and research documents.

## Start

From this isolated checkout, run `.venv-swarm/Scripts/python.exe -m swarm.server --port 8765` and open <http://127.0.0.1:8765/>. A hidden-process launcher is provided with the user-facing handoff. To rebuild the environment, create a Python 3.11+ virtual environment and install `swarm/requirements.txt`.

1. Try the existing **Sample mode** mission. Its replies are scripted and cost nothing.
2. Open **API connections** and enter a Gemini API key and an OpenAI API key. Keys entered here remain in server memory until disconnection or restart. They are never saved by this app or included in model prompts. Process environment variables are also supported; the app does not read SIGIL's `.env`.
3. Choose **New mission**, select **API mode**, and describe a narrow research question. Starting a mission sends paid API calls within the pilot limits.
4. Send follow-ups to the coordinator or a specialist. The controller delivers them to that role. Use **Stop** to prevent further dispatch; calls already sent may finish and be charged.

Configured means a key was entered. Verified means the provider returned a successful response. A real API mission has not yet been verified during implementation. The selected models are `gemini-3.1-flash-lite` and `gpt-5.6-sol`; unsupported accounts stop with a connection/model error rather than silently switching models.

September 4 troubleshooting: OpenAI planning calls succeeded, but Gemini returned HTTP 400. The configured Gemini name matches [Google's model reference](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite). The runner now sends Pydantic's schema through `response_json_schema`, avoiding unsupported fields in the legacy `responseSchema` format. A model-metadata lookup precedes paid planning, and errors identify the provider and distinguish known key, schema and thinking-setting failures without exposing SDK bodies. Full live verification of this correction requires reconnected session keys.

## What runs

The coordinator assigns relevant roles, the reviewer makes an independent first assessment, and specialists produce bounded documents and directed messages. The controller delivers requests without asking the coordinator to rewrite them. It then presents the complete latest documents to review and coordination. User questions received during a call remain queued until delivered in a later call.

There is one active mission, at most two simultaneous specialist calls, five assignment rounds and two rounds of peer revisions. Missions are manually started. No recurring scheduler is enabled; the previous browser automation stays paused.

Workers can request specific public HTML/text URLs from approved SEC, arXiv, PMLR and US statistical-agency domains. Fetches have size/time limits, checked redirects and local-address restrictions. This version has no general web-search tool, PDF extraction or market-data subscription. A fetched page proves retrieval, not the truth of a model's interpretation. Model documents remain labeled unverified.

Workers have no shell, file editing, broker or deployment tools. Engineering produces proposals in this version. This dashboard is isolated on `codex/sigil-company`; code-execution isolation is a later prerequisite, not provided by a Git branch. SIGIL's application, trading scheduler and production services are not started.

## Budget and persistence

The accepted pilot allowance is **$1 per America/New_York calendar day, $7 total, expiring September 11, 2026** for this installed workspace. The controller reserves a conservative allowance before every API call and records provider token usage afterward. Current standard rates are $0.25/$1.50 per million Gemini input/output tokens and $4/$20 for GPT. Output accounting includes reported thinking/reasoning. Pricing checked September 4: [Google](https://ai.google.dev/gemini-api/docs/pricing), [OpenAI](https://developers.openai.com/api/docs/pricing).

These are local model-spending controls based on those rates, not a provider billing cap; provider invoices, taxes and unrelated account usage can differ. No paid search or other paid tool is enabled. SDK retries are disabled. Missing usage, uncertain transport failures, unexpected model identity and interrupted reserved calls retain their allowance and block further live work until reconciled. Check the provider's usage record before resolving an uncertain ledger entry; never clear it to resume spending.

`.swarm/runtime/` contains mission JSON files, `messages.jsonl`, `budget.json`, `pilot.json` and a controller lock. One process owns this directory; a second controller cannot open it. Files survive a restart, but interrupted missions do not automatically resume. Keep this folder private: it contains mission text and research, though not submitted API keys. Do not delete it or choose a new data directory to reset the authorized allowance.

The service binds only to 127.0.0.1. It is intended for the owner of this computer and has no multiuser authentication. Do not publish it, expose the port or point a reverse proxy at it.

## Validation

`python -m pytest swarm/tests -q` passes 28 checks covering concurrent budget reservations, persistence, interrupted calls, model provenance, user/peer delivery, complete review context, request safety, source restrictions and actual SDK request serialization with mock transports. The regression checks cover the JSON-schema transport, model-metadata lookup before paid planning and redacted error classification. These checks use no paid model calls. Desktop/mobile browser checks cover a complete sample mission, directed follow-up, navigation, evidence and download. Full live collaboration, response quality and bill reconciliation still need the first API pilot.
