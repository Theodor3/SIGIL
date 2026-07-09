"""Point-in-time pipeline context snapshots — the raw material for backtests.

Every daily pipeline run archives its full PipelineContext (fundamentals,
market data, earnings, everything the signals saw) as gzipped JSON. A
backtest replays a signal's compute() over these recorded snapshots, so a
brand-new signal can be graded on exactly the data it *would* have seen —
no look-ahead, no survivorship, no reconstruction guesswork.
"""
from __future__ import annotations

import gzip
import json
from dataclasses import asdict, fields
from datetime import date
from pathlib import Path

from api.config.settings import settings
from api.data.context import PipelineContext

# Keep roughly 1.5 years of daily snapshots
MAX_SNAPSHOTS = 550


def snapshot_dir() -> Path:
    if settings.context_snapshot_dir:
        d = Path(settings.context_snapshot_dir)
    elif Path("/data").is_dir():
        d = Path("/data/contexts")
    else:
        d = Path("context_snapshots")
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_context(ctx: PipelineContext) -> Path:
    """Archive one run's context; same-day reruns overwrite."""
    data = asdict(ctx)
    data["as_of_date"] = ctx.as_of_date.isoformat()
    data["earnings_calendar"] = {
        t: (d.isoformat() if isinstance(d, date) else d)
        for t, d in ctx.earnings_calendar.items()
    }
    path = snapshot_dir() / f"{ctx.as_of_date.isoformat()}.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(data, f, default=str)
    _prune()
    return path


def list_snapshot_dates() -> list[date]:
    dates = []
    for p in snapshot_dir().glob("*.json.gz"):
        try:
            dates.append(date.fromisoformat(p.stem.replace(".json", "")))
        except ValueError:
            continue
    return sorted(dates)


def load_context(d: date) -> PipelineContext | None:
    path = snapshot_dir() / f"{d.isoformat()}.json.gz"
    if not path.exists():
        return None
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


def _prune() -> None:
    files = sorted(snapshot_dir().glob("*.json.gz"))
    for p in files[:-MAX_SNAPSHOTS]:
        try:
            p.unlink()
        except OSError:
            pass
