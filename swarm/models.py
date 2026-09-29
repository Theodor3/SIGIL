from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WorkerId = Literal[
    "research-events", "research-frontier", "data", "quant",
    "engineering", "review", "product-ops",
]
Recipient = Literal[
    "coordinator", "research-events", "research-frontier", "data", "quant",
    "engineering", "review", "product-ops",
]

GEMINI_MODEL = "gemini-3.1-flash-lite"
OPENAI_MODEL = "gpt-5.6-sol"
DAILY_LIMIT = 1.0
PILOT_LIMIT = 7.0
MAX_ROUNDS = 5
MAX_SPECIALISTS = 2

AGENTS = [
    dict(id="coordinator", name="Coordinator", role="Keeps the mission focused and reviews the result", initials="CO", color="#c3d76a", provider="OpenAI", model=OPENAI_MODEL),
    dict(id="research-events", name="Event researcher", role="Finds signals in filings, catalysts and timing", initials="ER", color="#b7cbd2", provider="Gemini", model=GEMINI_MODEL),
    dict(id="research-frontier", name="Frontier researcher", role="Explores unusual ideas and alternative explanations", initials="FR", color="#d4bbdc", provider="Gemini", model=GEMINI_MODEL),
    dict(id="data", name="Data engineer", role="Checks sources, coverage and observable timestamps", initials="DE", color="#9fc9b8", provider="Gemini", model=GEMINI_MODEL),
    dict(id="quant", name="Quant researcher", role="Defines experiments, baselines and failure conditions", initials="QR", color="#dfc695", provider="Gemini", model=GEMINI_MODEL),
    dict(id="engineering", name="Engineer", role="Proposes small, testable implementation changes", initials="EN", color="#b3bdeb", provider="Gemini", model=GEMINI_MODEL),
    dict(id="review", name="Independent reviewer", role="Challenges unsupported claims and checks the work", initials="IR", color="#e1aaa2", provider="Gemini", model=GEMINI_MODEL),
    dict(id="product-ops", name="Product & operations", role="Turns findings into a clear next step", initials="PO", color="#c4c0b4", provider="Gemini", model=GEMINI_MODEL),
]
AGENT_MAP = {a["id"]: a for a in AGENTS}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Assignment(StrictModel):
    agent_id: WorkerId
    task: str = Field(min_length=1, max_length=2000)


class Plan(StrictModel):
    message: str = Field(max_length=3000)
    assignments: list[Assignment] = Field(min_length=1, max_length=7)


class PeerMessage(StrictModel):
    recipient: Recipient
    kind: Literal["request", "response", "challenge", "finding"]
    text: str = Field(min_length=1, max_length=1600)


class Source(StrictModel):
    title: str = Field(max_length=200)
    url: str = Field(max_length=1000)


class StudioClaim(StrictModel):
    field: str = Field(min_length=1, max_length=180)
    status: Literal["present", "absent", "unproven"]
    observation: str = Field(min_length=1, max_length=1200)
    consequence: str = Field(min_length=1, max_length=1200)
    tool_result_ids: list[str] = Field(min_length=1, max_length=9)


class ToolRequest(StrictModel):
    tool: Literal["read_file", "search_code", "draft_file", "check_syntax", "run_tests", "web_search", "paper_search", "fetch_page"]
    path: str = Field(default="", max_length=240)
    query: str = Field(default="", max_length=400)
    start: int = Field(default=1, ge=1, le=100000)
    content: str = Field(default="", max_length=12000)


class Report(StrictModel):
    summary: str = Field(min_length=1, max_length=2500)
    artifact_title: str = Field(min_length=1, max_length=180)
    artifact_body: str = Field(min_length=1, max_length=4000)
    messages: list[PeerMessage] = Field(max_length=3)
    sources: list[Source] = Field(max_length=6)
    source_requests: list[str] = Field(max_length=2)
    tool_requests: list[ToolRequest] = Field(default_factory=list, max_length=3)
    studio_claims: list[StudioClaim] = Field(default_factory=list, max_length=12)


class Verdict(StrictModel):
    message: str = Field(min_length=1, max_length=3500)
    outcome: Literal["ready_for_user", "revise", "blocked"]
    assignments: list[Assignment] = Field(max_length=3)


class NewMission(StrictModel):
    prompt: str = Field(min_length=1, max_length=6000)
    mode: Literal["demo", "live", "local"] = "demo"
    local_role: Literal["data", "engineering", "quant", "product-ops"] = "data"
    max_revisions: int = Field(default=1, ge=0, le=MAX_ROUNDS - 1)
    specialist_execution: Literal["parallel", "sequential"] = "parallel"
    requires_tests: bool = False


class UserMessage(StrictModel):
    text: str = Field(min_length=1, max_length=4000)
    recipient: Recipient = "coordinator"


class LocalReview(StrictModel):
    accepted: bool
    reviewer: Literal["user", "codex"]
    note: str = Field(min_length=10, max_length=4000)


class ProviderKeys(StrictModel):
    gemini_api_key: str | None = Field(default=None, max_length=512)
    openai_api_key: str | None = Field(default=None, max_length=512)


class Disconnect(StrictModel):
    provider: Literal["gemini", "openai"]
