"""Fixed-vocabulary diagnostics: never persist provider prose or request content."""
import hashlib
import json
import re


def request_profile(system, prompt, schema):
    raw = json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()
    profile = dict(schema_sha256=hashlib.sha256(raw).hexdigest(), schema_bytes=len(raw),
                   system_bytes=len(system.encode()), prompt_bytes=len(prompt.encode()),
                   enum_values=0, array_bounds=0, zero_arrays=0)
    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("enum"), list):
                profile["enum_values"] += len(node["enum"])
            if "maxItems" in node:
                profile["array_bounds"] += 1
                profile["zero_arrays"] += int(node["maxItems"] == 0)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(schema)
    return profile


def error_detail(exc):
    """Read bounded known SDK error shapes for classification, never logging them."""
    parts = []
    def collect(value, depth=0):
        if depth > 8 or len(parts) >= 24:
            return
        if isinstance(value, str):
            parts.append(value[:4000])
        elif isinstance(value, dict):
            for key in ("error", "details", "fieldViolations", "message", "description", "field", "reason"):
                if key in value:
                    collect(value[key], depth + 1)
        elif isinstance(value, list):
            for child in value[:12]:
                collect(child, depth + 1)
    collect(getattr(exc, "message", None))
    collect(getattr(exc, "details", None))
    collect(getattr(exc, "body", None))
    return " ".join(parts).lower()


def safe_error_hint(exc, detail):
    statuses = {"INVALID_ARGUMENT", "FAILED_PRECONDITION", "RESOURCE_EXHAUSTED",
                "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND"}
    status = getattr(exc, "status", None)
    status = status if isinstance(status, str) and status in statuses else "unreported"
    # Only application-owned field names can escape. No raw message fragments.
    fields = {
        "response_schema": ("response_schema", "responseschema", "response_json_schema", "responsejsonschema"),
        "thinking": ("thinking",), "max_output_tokens": ("max_output_tokens", "maxoutputtokens"),
        "contents": ("contents",), "system_instruction": ("system_instruction", "systeminstruction"),
    }
    names = [name for name, variants in fields.items()
             if any(re.search(r"(?<![a-z])" + value + r"(?![a-z])", detail) for value in variants)]
    generic = "yes" if "request contains an invalid argument" in detail else "no"
    return f"[status={status}; fields={','.join(names) or 'unreported'}; generic_invalid_argument={generic}]"
