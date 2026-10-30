"""Read-only public projection of the local experiment registry.

The registry remains an operational record, not a source of dispatch authority.
Never return arbitrary registry fields or follow its local evidence paths.
"""
import json
import re
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Finding(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    id: str
    status: str
    summary: str


class Experiment(BaseModel):
    model_config = ConfigDict(strict=True, extra="ignore")
    id: str
    title: str
    type: str
    ticker: str
    stage: str
    status: str
    hypothesisVersion: str
    hypothesis: str
    createdAt: str
    decisionAt: str | None = None
    targetAt: str | None = None

    @field_validator("createdAt", "decisionAt", "targetAt")
    @classmethod
    def validate_time(cls, value, info):
        if value is None:
            return value
        if len(value) == 10 and info.field_name == "createdAt":
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError("Invalid date")
        else:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
                raise ValueError("Canonical aware instant required")
            stamp = datetime.fromisoformat(value)
            if stamp.tzinfo is None or stamp.utcoffset() is None:
                raise ValueError("Aware instant required")
        return value
    @model_validator(mode="after")
    def check_order(self):
        if self.decisionAt and self.targetAt and datetime.fromisoformat(self.targetAt) <= datetime.fromisoformat(self.decisionAt):
            raise ValueError("Target must follow decision")
        return self

    nextAction: str
    sourceSamples: int = Field(ge=0)
    originalPublicationTimesVerified: bool
    predictiveResultsAvailable: bool
    findings: list[Finding]


def read_experiments(root):
    """Load one fixed file; malformed records fail visibly, never look empty."""
    try:
        path = root / ".swarm" / "experiments.json"
        raw = path.read_bytes()
        if len(raw) > 1_000_000:
            raise ValueError("Oversized registry")
        data = json.loads(raw)
        if (not isinstance(data, dict) or type(data.get("schemaVersion")) is not int
                or data["schemaVersion"] != 1 or not isinstance(data.get("experiments"), list)):
            raise ValueError("Unsupported registry")
        records = [Experiment.model_validate(item).model_dump(exclude_none=True) for item in data["experiments"]]
        if len({item["id"] for item in records}) != len(records):
            raise ValueError("Duplicate experiment identity")
        return {"schemaVersion": 1, "readOnly": True, "experiments": records}
    except (OSError, ValueError, TypeError):
        # Validation errors include input values and paths: keep those private.
        raise ValueError("The experiment registry is unavailable or invalid.") from None
