"""Deterministic local read coverage and explicitly supplied text excerpts."""
import hashlib
import json
from urllib.parse import urlsplit


def read_coverage(records, *, role, task_id, path, sha256, commit, total_lines):
    """Require continuous coverage from this role's current task, not a peer."""
    spans = []
    ids = []
    for record in records:
        raw = record.get("result", {})
        if (record.get("agent_id") != role or record.get("task_id") != task_id
                or record.get("tool") != "read_file" or record.get("status") != "completed"
                or raw.get("path") != path or raw.get("sha256") != sha256
                or raw.get("commit") != commit or raw.get("total_lines") != total_lines
                or raw.get("text_truncated") is not False):
            continue
        start, end = raw.get("start"), raw.get("end")
        if (type(start) is not int or type(end) is not int
                or not 1 <= start <= end <= total_lines or not raw.get("text")):
            continue
        spans.append((start, end))
        ids.append(record["id"])
    through = 0
    for start, end in sorted(spans):
        if start > through + 1:
            break
        through = max(through, end)
    return {"path": path, "complete": total_lines > 0 and through == total_lines,
            "covered_through": through, "total_lines": total_lines, "read_ids": ids}


def supplied_excerpt(text, *, source_url, retrieved_at, context, start, end):
    """Package a bounded excerpt; never retrieve a URL or assert availability."""
    from .studio import SECRET_LITERAL
    url = urlsplit(source_url)
    if (len(source_url) > 1000 or url.scheme != "https" or not url.hostname
            or url.username or url.password):
        raise ValueError("Supply a public HTTPS source label; no retrieval is performed.")
    if not retrieved_at or len(retrieved_at) > 100 or not context or len(context) > 500:
        raise ValueError("Supply retrieval and section context labels.")
    if (len(text.encode("utf-8")) > 10_000_000 or SECRET_LITERAL.search(text)
            or any(ord(c) < 32 and c not in '\r\n\t' for c in text)):
        raise ValueError("Supplied text is oversized or contains sensitive literals.")
    lines = text.splitlines(keepends=True)
    if (type(start) is not int or type(end) is not int
            or not 1 <= start <= end <= len(lines) or end - start >= 80):
        raise ValueError("Select 1 to 80 existing lines, including table headings/context.")
    excerpt = "".join(lines[start - 1:end])
    packet = {"schema_version": 1, "status": "supplied_text_excerpt_not_original_document",
              "source_url": source_url, "retrieved_at_supplied_unverified": retrieved_at,
              "context_supplied_unverified": context,
              "supplied_text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
              "hash_scope": "UTF-8 supplied text, not original HTML or PDF",
              "start_line": start, "end_line": end, "total_supplied_lines": len(lines),
              "excerpt_sha256": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
              "excerpt": excerpt, "scope": "selected lines only; omissions unverified",
              "worker_retrieved": False, "availability_verified": False,
              "latest_prior_verified": False, "eligibleForReturns": False}
    if len(json.dumps(packet, ensure_ascii=False, indent=2).encode("utf-8")) > 7500:
        raise ValueError("Excerpt exceeds one bounded Studio read; select fewer lines.")
    return packet


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description="Package explicitly supplied public text; no network access.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    for name in ("source-url", "retrieved-at", "context"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--start", required=True, type=int)
    parser.add_argument("--end", required=True, type=int)
    args = parser.parse_args()
    if args.input.stat().st_size > 10_000_000:
        parser.error("Supplied input exceeds 10 MB.")
    packet = supplied_excerpt(args.input.read_bytes().decode("utf-8"),
        source_url=args.source_url, retrieved_at=args.retrieved_at, context=args.context,
        start=args.start, end=args.end)
    with args.output.open("x", encoding="utf-8", newline="\n") as output:
        output.write(json.dumps(packet, ensure_ascii=False, indent=2) + "\n")
