"""Single supplied-packet subscription mission; no API ledger or worker tools."""
import json
from datetime import datetime, timezone

from .claude_code import ClaudeCodeBlocked, mission_window
from .models import SubscriptionReport, ToolRequest
from .store import now, uid

MODEL = 'claude-sonnet-4-6'


def check_approval(approval):
    if not isinstance(approval, dict) or approval.get('usage_credits_disabled') is not True:
        raise ValueError('A per-run usage-credits-disabled confirmation is required at dispatch.')
    try:
        stamp = datetime.fromisoformat(approval['checked_at'])
        age = (datetime.now(timezone.utc) - stamp).total_seconds()
        if not 0 <= age <= 300 or len(approval['verification_note']) < 10:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise ValueError('Run confirmation must be timestamped within the last five minutes.') from None
    try:
        window = (datetime.fromisoformat(approval['no_new_after']),
                  datetime.fromisoformat(approval['stop_at']))
        return mission_window(window)
    except (ValueError, KeyError, TypeError, ClaudeCodeBlocked):
        raise ValueError('Explicit aware launch cutoff and hard stop must be future, ordered, '
                         'and within thirty minutes. No automatic renewal.') from None


def packet_from_read(record):
    raw = record.get('result', {})
    if record.get('status') != 'completed' or not raw.get('complete_file') or raw.get('text_truncated'):
        raise ValueError('The supplied packet requires one complete untruncated Studio read.')
    try:
        packet = json.loads(raw['text'])
        if (packet.get('schema_version') != 1 or packet.get('eligibleForReturns') is not False
                or packet.get('status') not in ('coordinator_supplied_web_extraction_not_raw_html',
                                              'supplied_text_excerpt_not_original_document')):
            raise ValueError()
    except (ValueError, TypeError, AttributeError, KeyError):
        raise ValueError('Expected an explicitly supplied public evidence packet with false eligibility.') from None
    return packet


def run_packet(engine, mission_id):
    store = engine.store
    with store.lock:
        data = store.get(mission_id)
        dispatch_window = check_approval(data['mission'].get('subscription_approval'))
        path = data['mission']['packet_path']
        task_id = uid('task')
        data['tasks'].append(dict(id=task_id, agent_id='data', title='Review supplied public packet',
                                 status='running', round=1))
        data['participants'] = ['data']
        manifest = engine.studio.manifest()
        data['studio'] = {'commit': manifest['commit'], 'branch': manifest['branch'], 'files': [path]}
        data['mission'].update(round=1, provider_routes={'data': 'claude_code_subscription'}, replay_allowed=False)
        store.save(data)
    read = engine.tools.execute(mission_id, 'data', ToolRequest(tool='read_file', path=path),
                                engine.check_stop, task_id=task_id)
    packet = packet_from_read(read)
    receipt = {'id': uid('subscription'), 'provider': 'claude_code_subscription', 'model': MODEL,
               'status': 'running', 'phase': 'prepared', 'started_at': now(),
               'quota_usage': 'not_started', 'quota_remaining': None, 'api_cost_usd': None,
               'packet_read_id': read['id'], 'packet_sha256': read['result']['sha256'],
               'commit': read['result']['commit'], 'max_turns': data['mission'].get('max_turns', 2),
               'dispatch_window': {'no_new_after': dispatch_window[0].isoformat(),
                                   'stop_at': dispatch_window[1].isoformat()}}
    with store.lock:
        data['subscription_calls'] = [receipt]
        store.save(data)

    def progress(phase):
        engine.check_stop()
        with store.lock:
            receipt['phase'] = phase
            if phase in ('generation_launch', 'result_validation'):
                receipt['quota_usage'] = 'unknown'
            store.save(data)
    try:
        result = engine.subscription_adapter.run(packet, data['mission']['prompt'], SubscriptionReport,
            model=MODEL, extra_usage_disabled_confirmed=True, timeout=90,
            cancel=engine.stop_event, progress=progress, max_turns=receipt['max_turns'],
            dispatch_window=dispatch_window)
        engine.check_stop()
        report = SubscriptionReport.model_validate(result['result'])
        source = read['result']
        # Controller-supplied binding is separate from model claims; never
        # represent the packet hash as a fetched original-document hash.
        body = report.artifact_body + '\n\nSupplied packet only: ' + path + \
            f" lines {source['start']}-{source['end']}; SHA-256 {source['sha256']}; commit {source['commit']}. " + \
            'No worker retrieval or verified historical availability. Return eligibility=false.'
        store.artifact(mission_id, 'data', report.artifact_title, body, [])
        with store.lock:
            receipt.update(status='completed', phase='completed', finished_at=now(),
                           quota_usage='reported_tokens_only', result=result)
            data['tasks'][-1]['status'] = 'completed'
            store.save(data)
        engine._status(mission_id, 'needs_review',
            'Subscription packet result requires external review; no critic or further call dispatched.')
    except Exception as exc:
        with store.lock:
            receipt.update(status='failed', finished_at=now(),
                error=str(exc) if isinstance(exc, ClaudeCodeBlocked) else 'Stopped or controller validation failed; no retry.')
            store.save(data)
        if isinstance(exc, ClaudeCodeBlocked):
            raise ValueError(str(exc)) from None
        raise
