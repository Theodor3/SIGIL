"""Compact local JSON changes structural whitespace only; paid formatting stays."""
import copy
import json

from swarm.engine import Engine


class Snapshot:
    def __init__(self, mode):
        self.data = {
            'mission': {'mode': mode, 'prompt': 'Keep  two spaces\nand \"quotes\" café'},
            'tasks': [], 'messages': [{'id': 'msg-fixture', 'sender': 'user',
                'recipient': 'review', 'kind': 'mission', 'text': 'one  two\n  three'}],
            'artifacts': [{'id': 'art-fixture', 'author': 'engineering', 'title': 'Title',
                'body': 'a = 1\n  keep_indent = True\nTAIL', 'verification': 'unverified',
                'sources': []}],
            'tool_results': [], 'sources': [], 'drafts': [], 'participants': ['review'],
        }

    def snapshot(self, mission_id):
        return copy.deepcopy(self.data)


def prompt(mode):
    engine = Engine.__new__(Engine)
    engine.store = Snapshot(mode)
    before = copy.deepcopy(engine.store.data)
    result = engine._context('fixture', 'review', 'Review  exact\ntext')[0]
    assert engine.store.data == before
    return result


def test_local_json_is_structurally_compact_and_preserves_all_strings():
    actual = prompt('local')
    context = json.loads(actual)
    assert actual == json.dumps(context, ensure_ascii=False, separators=(',', ':'))
    assert len(actual.encode()) < len(json.dumps(context, ensure_ascii=False).encode())
    assert context['mission'] == 'Keep  two spaces\nand \"quotes\" café'
    assert context['messages_addressed_to_you'][0]['text'] == 'one  two\n  three'
    assert context['relevant_artifacts'][0]['body'] == 'a = 1\n  keep_indent = True\nTAIL'
    assert context['your_task'] == 'Review  exact\ntext'


def test_paid_prompt_keeps_existing_json_serialization():
    actual = prompt('live')
    assert actual == json.dumps(json.loads(actual), ensure_ascii=False)
