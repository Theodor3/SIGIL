"""Narrow generation choices to controller-provided evidence and role scope.

Runtime validation remains authoritative; this only prevents avoidable model errors.
"""
import json
import re

from .models import Report


def response_schema(schema, prompt):
    result = schema.model_json_schema()
    if schema is not Report:
        return result
    try:
        context = json.loads(prompt)
    except (ValueError, TypeError):
        return result
    if not isinstance(context, dict) or 'your_current_source_evidence' not in context:
        return result
    ids = sorted({r['id'] for group in (
        'your_current_source_evidence', 'your_prior_source_evidence',
        'upstream_source_evidence', 'team_source_evidence',
    ) for r in context.get(group, [])
        if isinstance(r, dict) and re.fullmatch(r'tool_[0-9a-f]{16}', str(r.get('id', '')))
        and r.get('text') and not r.get('text_truncated')})
    if ids:
        evidence_field = result['$defs']['StudioClaim']['properties']['tool_result_ids']
        evidence_field['items']['enum'] = ids
        evidence_field['maxItems'] = min(evidence_field['maxItems'], len(ids))
    else:
        result['properties']['studio_claims']['maxItems'] = 0
    tool_field = result['$defs']['ToolRequest']['properties']['tool']
    allowed = context.get('allowed_tools')
    if isinstance(allowed, list):
        tools = [t for t in tool_field['enum'] if t in allowed]
        if tools:
            tool_field['enum'] = tools
        else:
            result['properties']['tool_requests']['maxItems'] = 0
    recipients = context.get('allowed_recipients')
    if isinstance(recipients, list) and recipients:
        field = result['$defs']['PeerMessage']['properties']['recipient']
        field['enum'] = [r for r in field['enum'] if r in recipients]
    if context.get('independent_critique'):
        result['properties']['messages']['maxItems'] = 0
    if context.get('mission_mode') == 'local' or context.get('independent_critique') or ids:
        result['properties']['source_requests']['maxItems'] = 0
    return result
