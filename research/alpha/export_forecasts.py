"""Local-only, read-only export of existing research tables from a supplied SQLite DB.

Use a coherent offline copy acquired through an approved backup process, never
an ad-hoc copy of a live WAL main file. Long read transactions can pin WAL growth;
do not run this against the nearly-full production volume.
No runtime imports, network, account tables, inference, repricing or writeback.
Stored naive timestamps remain naive; this never creates eligible forecast times.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sqlite3


TABLES = {
    "pipeline_runs": ("id", "started_at", "finished_at", "status"),
    "signal_predictions": ("id", "run_id", "run_date", "signal_name", "signal_version", "ticker", "score", "confidence", "metadata"),
    "signal_evaluations": ("id", "prediction_id", "horizon_days", "actual_return", "signal_correct", "alpha_vs_benchmark", "evaluated_at"),
}


def export_forecasts(database, output_dir, *, max_rows=100000, max_bytes=100000000):
    database, output_dir = Path(database).resolve(), Path(output_dir).resolve()
    if not database.is_file():
        raise ValueError("Explicit existing SQLite research database required")
    if type(max_rows) is not int or max_rows <= 0 or type(max_bytes) is not int or max_bytes <= 0:
        raise ValueError("Positive export size bounds required")
    started = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only=ON")
        conn.execute("BEGIN")
        tables = {}
        estimated_bytes = 4096
        for name, required in TABLES.items():
            kind = conn.execute("SELECT type FROM sqlite_master WHERE name=?", (name,)).fetchone()
            if not kind or kind[0] != "table":
                raise ValueError("Missing research table: " + name)
            columns = {row[1] for row in conn.execute(f"PRAGMA table_info({name})")}
            if not set(required) <= columns:
                raise ValueError("Missing required research columns: " + name)
            count = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
            if count > max_rows:
                raise ValueError("Export row bound exceeded: " + name)
            # Conservative JSON escaping allowance before reading metadata into
            # Python. BLOB length counts UTF-8 bytes rather than Unicode chars.
            lengths = "+".join(f"COALESCE(length(CAST({column} AS BLOB)),0)" for column in required)
            raw_bytes = conn.execute(f"SELECT COALESCE(SUM({lengths}),0) FROM {name}").fetchone()[0]
            estimated_bytes += 6 * raw_bytes + count * len(required) * 64
            if estimated_bytes > max_bytes:
                raise ValueError("Export byte bound exceeded during preflight")
            # Deliberate whitelist: no account, trades, orders, credentials or settings.
            rows = conn.execute(f"SELECT {','.join(required)} FROM {name} ORDER BY id")
            tables[name] = [dict(row) for row in rows]
        run_ids = {row["id"] for row in tables["pipeline_runs"]}
        prediction_ids = {row["id"] for row in tables["signal_predictions"]}
        payload = {"schema_version": 1, "acquired_at": started,
                   "tables": tables,
                   "coverage": {
                       "counts": {name: len(rows) for name, rows in tables.items()},
                       "completed_runs": sum(row["status"] == "completed" for row in tables["pipeline_runs"]),
                       "orphan_predictions": sum(row["run_id"] not in run_ids for row in tables["signal_predictions"]),
                       "orphan_evaluations": sum(row["prediction_id"] not in prediction_ids for row in tables["signal_evaluations"]),
                   },
                   "point_in_time_eligible": False,
                   "limitations": ["Read transaction is consistent, not proof historical records were immutable or complete.",
                     "Stored timestamps preserved without inferring timezone, publication or transaction commit time.",
                     "Run/version/source provenance and original forecast availability require separate verification.",
                     "Stored evaluations lack exact entry/exit/benchmark price receipts; no repricing performed."]}
        encoded = (json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()
        if len(encoded) > max_bytes:
            raise ValueError("Export byte bound exceeded")
    finally:
        conn.close()  # ends read transaction; never commits to source
    digest = hashlib.sha256(encoded).hexdigest()
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / (digest + ".json")
    if target.exists():
        if target.read_bytes() != encoded:
            raise ValueError("Content-addressed output was modified")
    else:
        with target.open("xb") as file:
            file.write(encoded)
    return {"sha256": digest, "bytes": len(encoded), "file": str(target), "coverage": payload["coverage"], "point_in_time_eligible": False}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database")
    parser.add_argument("local_output_dir")
    args = parser.parse_args()
    print(json.dumps(export_forecasts(args.database, args.local_output_dir), indent=2))
