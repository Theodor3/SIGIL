"""Canonical run-bound scores. Readers never reconstruct old rankings."""
import math
from dataclasses import asdict
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SavedScore(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    rank: int = Field(ge=1)
    ticker: str = Field(min_length=1)
    final_score: float
    confidence: float = Field(ge=0, le=1)
    signal_scores: dict[str, float]
    eligible: bool
    gate_flags: dict[str, bool]
    sector: str
    market_cap: float | None = None

class ScoreSnapshot(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    schema_version: Literal[1]
    scoring_method: Literal["confidence_weighted_regime_v1"]
    run_id: str
    decision_at: str
    rows: list[SavedScore]

    @field_validator('decision_at')
    @classmethod
    def aware_decision(cls, value):
        stamp = datetime.fromisoformat(value)
        if stamp.tzinfo is None or stamp.utcoffset() is None:
            raise ValueError('Timezone required')
        return value

    @model_validator(mode='after')
    def ordered_unique_rows(self):
        if [r.rank for r in self.rows] != list(range(1, len(self.rows) + 1)):
            raise ValueError('Contiguous ranks required')
        if len({r.ticker for r in self.rows}) != len(self.rows):
            raise ValueError('Duplicate ticker')
        if any(a.final_score < b.final_score for a, b in zip(self.rows, self.rows[1:])):
            raise ValueError('Descending scores required')
        return self


def _build_score_snapshot(run_id, scored, fundamentals, decision_at):
    """Capture the scorer's actual output, never run a second scoring formula."""
    rows = []
    for rank, score in enumerate(scored, 1):
        fund = fundamentals.get(score.ticker, {})
        market_cap = fund.get('market_cap')
        if not isinstance(market_cap, (int, float)) or isinstance(market_cap, bool):
            market_cap = None
        elif not math.isfinite(market_cap):
            market_cap = None
        sector = fund.get('sector')
        rows.append({**asdict(score), 'rank': rank,
                     'sector': sector if isinstance(sector, str) else '',
                     'market_cap': market_cap})
    return ScoreSnapshot(schema_version=1, scoring_method="confidence_weighted_regime_v1",
                         run_id=run_id, decision_at=decision_at, rows=rows).model_dump()


def read_run_scores(run):
    """Return a validated copy and explicit missing/invalid provenance state."""
    if run is None:
        return [], 'no_run'
    if run.score_snapshot is None:
        return [], 'legacy_unavailable'
    if run.score_snapshot == {"schema_version": 1, "status": "serialization_unavailable"}:
        return [], "serialization_unavailable"
    try:
        snapshot = ScoreSnapshot.model_validate(run.score_snapshot)
        if snapshot.run_id != run.id:
            raise ValueError('Run identity mismatch')
        return [row.model_dump() for row in snapshot.rows], 'saved'
    except (TypeError, ValueError):
        return [], 'invalid_snapshot'


def build_score_snapshot(run_id, scored, fundamentals, decision_at):
    """Best-effort display capture: never mutate scores or fail a completed pipeline."""
    try:
        snapshot = _build_score_snapshot(run_id, scored, fundamentals, decision_at)
        # Exercise the same JSON boundary used for persistence, before DB commit.
        import json
        return json.loads(json.dumps(snapshot, allow_nan=False))
    except Exception:
        return {"schema_version": 1, "status": "serialization_unavailable"}