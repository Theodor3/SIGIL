"""Read-only public projection of the local experiment registry.

The registry remains an operational record, not a source of dispatch authority.
Never return arbitrary registry fields or follow its local evidence paths.
"""
import json

from pydantic import BaseModel, ConfigDict, Field


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
        records = [Experiment.model_validate(item).model_dump() for item in data["experiments"]]
        if len({item["id"] for item in records}) != len(records):
            raise ValueError("Duplicate experiment identity")
        return {"schemaVersion": 1, "readOnly": True, "experiments": records}
    except (OSError, ValueError, TypeError):
        # Validation errors include input values and paths: keep those private.
        raise ValueError("The experiment registry is unavailable or invalid.") from None
