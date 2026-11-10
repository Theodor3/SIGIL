"""Read-only accounting from saved LLM predictions, never an invoice estimate."""

TOKEN_FIELDS = (
    "input_tokens", "output_tokens", "cache_creation_input_tokens",
    "cache_read_input_tokens",
)
NOT_REQUESTED_REASONS = {"no_api_key", "anthropic_not_installed", "not_scored"}


def summarize_usage(metadata_rows) -> dict:
    rows = list(metadata_rows)
    attempted = []
    skipped = 0
    for metadata in rows:
        metadata = metadata if isinstance(metadata, dict) else {}
        reason = metadata.get("reason")
        if isinstance(reason, str) and reason in NOT_REQUESTED_REASONS:
            skipped += 1
            continue
        usage = metadata.get("provider_usage")
        attempted.append(usage if isinstance(usage, dict) and
                         usage.get("provider") == "anthropic" else {})

    counters = {}
    for field in TOKEN_FIELDS:
        known = [row[field] for row in attempted
                 if type(row.get(field)) is int and row[field] >= 0]
        complete = bool(attempted) and len(known) == len(attempted)
        counters[field] = {
            "total": sum(known) if complete else None,
            "reported_subtotal": sum(known) if known else None,
            "reported_records": len(known),
            "unknown_records": len(attempted) - len(known),
        }
    complete = bool(attempted) and all(
        counters[field]["unknown_records"] == 0 for field in TOKEN_FIELDS[:2])
    has_reported = any(counters[field]["reported_records"] for field in TOKEN_FIELDS[:2])
    return {
        "schema_version": 1,
        "scope": "persisted_llm_conviction_responses",
        "status": "reported" if complete else ("partial" if has_reported else "unknown"),
        "saved_records": len(rows),
        "not_requested_records": skipped,
        "attempted_or_unknown_records": len(attempted),
        "tokens": counters,
        "cost_usd": None,
        "cost_status": "unknown",
        "billing_complete": False,
        "limitations": [
            "Only saved prediction metadata is counted; missing or failed runs may have unsaved usage.",
            "SDK retries and provider billing adjustments are not recorded.",
            "Token totals are not dollar costs; no pricing or invoice reconciliation is applied.",
        ],
    }
