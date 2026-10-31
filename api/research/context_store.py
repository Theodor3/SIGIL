"""Immutable local pipeline-context receipts for bounded research replay.

Retained input bytes are evidence of local capture, not proof of first public
availability, historical universes, source-vintage completeness or tradability.
"""
from __future__ import annotations

import gzip
import json
import hashlib
import uuid
import re
from dataclasses import asdict, fields
from datetime import date, datetime, timezone
from pathlib import Path

from api.config.settings import settings
from api.data.context import PipelineContext



def snapshot_dir() -> Path:
    if settings.context_snapshot_dir:
        d = Path(settings.context_snapshot_dir)
    elif Path("/data").is_dir():
        d = Path("/data/contexts")
    else:
        d = Path("context_snapshots")
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_context(ctx: PipelineContext, *, run_id: str | None = None) -> Path:
    """Append one immutable local receipt; never replace or prune historical bytes."""
    data = asdict(ctx)
    data["as_of_date"] = ctx.as_of_date.isoformat()
    data["earnings_calendar"] = {
        t: (d.isoformat() if isinstance(d, date) else d)
        for t, d in ctx.earnings_calendar.items()
    }
    content = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str).encode()
    captured = datetime.now(timezone.utc)
    identity = uuid.uuid4().hex
    data["_snapshot"] = {
        "schema_version": 1, "snapshot_id": identity, "run_id": run_id,
        "captured_at": captured.isoformat(), "context_sha256": hashlib.sha256(content).hexdigest(),
        "availability_basis": "local_context_receipt_not_source_publication",
        "source_publication_times_verified": False,
    }
    data["_snapshot"]["receipt_sha256"] = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    name = f"{ctx.as_of_date.isoformat()}__{captured.strftime('%Y%m%dT%H%M%S%fZ')}__{identity}.json.gz"
    path = snapshot_dir() / name
    with gzip.open(path, "xt", encoding="utf-8") as f:
        json.dump(data, f, default=str)
    return path


def snapshot_metadata(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)
    metadata = data.get("_snapshot")
    if not isinstance(metadata, dict):
        return {"availability_basis": "legacy_unknown", "captured_at": None}
    payload = {k: v for k, v in data.items() if k != "_snapshot"}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    if digest != metadata.get("context_sha256"):
        raise ValueError("Context receipt content hash mismatch")
    unsigned = dict(data)
    unsigned["_snapshot"] = {k: v for k, v in metadata.items() if k != "receipt_sha256"}
    receipt_hash = hashlib.sha256(json.dumps(unsigned, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    if receipt_hash != metadata.get("receipt_sha256"):
        raise ValueError("Context receipt provenance hash mismatch")
    return dict(metadata)


def list_snapshot_dates() -> list[date]:
    dates = set()
    for p in snapshot_dir().glob("*.json.gz"):
        try:
            dates.add(date.fromisoformat(p.name[:10]))
        except ValueError:
            continue
    return sorted(dates)


def load_context(d: date) -> PipelineContext | None:
    path = snapshot_dir() / f"{d.isoformat()}.json.gz"
    versions = sorted(snapshot_dir().glob(f"{d.isoformat()}__*.json.gz"))
    if path.exists() and versions:
        raise ValueError("Multiple context versions; choose an explicit snapshot for replay")
    if len(versions) > 1:
        raise ValueError("Multiple context versions; choose an explicit snapshot for replay")
    if versions:
        path = versions[0]
    if not path.exists():
        return None
    if versions:
        snapshot_metadata(path)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        data = json.load(f)

    data["as_of_date"] = date.fromisoformat(data["as_of_date"])
    cal = {}
    for t, v in (data.get("earnings_calendar") or {}).items():
        try:
            cal[t] = date.fromisoformat(v) if v else None
        except (ValueError, TypeError):
            cal[t] = None
    data["earnings_calendar"] = {t: v for t, v in cal.items() if v is not None}

    # Tolerate schema drift: only pass fields the dataclass still declares
    known = {f.name for f in fields(PipelineContext)}
    return PipelineContext(**{k: v for k, v in data.items() if k in known})



def context_receipt(d: date) -> dict:
    versions = sorted(snapshot_dir().glob(f"{d.isoformat()}__*.json.gz"))
    if len(versions) != 1 or (snapshot_dir() / f"{d.isoformat()}.json.gz").exists():
        raise ValueError("Missing or ambiguous immutable receipt; select explicit version")
    return snapshot_metadata(versions[0])

def verify_snapshot_reference(reference: dict) -> bool:
    """Resolve fixed UUID identity; never follow a caller-supplied path."""
    identity = reference.get("snapshot_id") if isinstance(reference, dict) else None
    if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity):
        return False
    paths = list(snapshot_dir().glob(f"*__{identity}.json.gz"))
    if len(paths) != 1:
        return False
    try:
        return snapshot_metadata(paths[0]) == reference
    except (OSError, ValueError, TypeError, EOFError):
        return False
