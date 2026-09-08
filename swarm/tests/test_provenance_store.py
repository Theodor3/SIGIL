import copy

import pytest

from swarm.store import Store


COMMIT = "a" * 40
SOURCE_HASH = "ab" * 32
SOURCE_PATH = "api/data/edgar.py"
RECORD_ID = "tool_0123456789abcdef"
TASK_ID = "task_0123456789abcdef"


def seeded_store(tmp_path):
    store = Store(tmp_path)
    mission_id = store.create("Inspect pinned source", "live")["id"]
    data = store.get(mission_id)
    data["studio"] = {"commit": COMMIT, "files": [SOURCE_PATH]}
    data["tool_results"] = [{
        "id": RECORD_ID,
        "task_id": TASK_ID,
        "agent_id": "data",
        "tool": "read_file",
        "status": "completed",
        "path": SOURCE_PATH,
        "result": {
            "path": SOURCE_PATH,
            "start": 1,
            "end": 12,
            "total_lines": 12,
            "text": "fixture source\n",
            "line_truncated": False,
            "text_truncated": False,
            "complete_file": True,
            "sha256": SOURCE_HASH,
            "commit": COMMIT,
        },
    }]
    store.save(data)
    claim = {
        "field": "SEC acceptance datetime",
        "status": "absent",
        "observation": "The inspected provider exposes filing date but no acceptance datetime.",
        "consequence": "Intraday point-in-time evaluation is not supported by this path.",
        "evidence": [{
            "tool_result_id": RECORD_ID,
            "task_id": TASK_ID,
            "agent_id": "data",
            "path": SOURCE_PATH,
            "start": 1,
            "end": 12,
            "total_lines": 12,
            "line_truncated": False,
            "text_truncated": False,
            "complete_file": True,
            "sha256": SOURCE_HASH,
            "commit": COMMIT,
        }],
    }
    return store, mission_id, claim


def test_source_linked_claim_is_cross_checked_and_persists(tmp_path):
    store, mission_id, claim = seeded_store(tmp_path)
    try:
        artifact = store.artifact(
            mission_id,
            "data",
            "Field availability",
            "Controller-rendered claim",
            provenance_status="source_linked",
            studio_claims=[claim],
        )
        assert artifact["provenance_status"] == "source_linked"
        assert artifact["studio_claims"] == [claim]
        assert artifact["verification"] == "unverified"
    finally:
        store.close()

    reopened = Store(tmp_path)
    try:
        saved = reopened.snapshot(mission_id)["artifacts"]
        assert len(saved) == 1
        assert saved[0]["provenance_status"] == "source_linked"
        assert saved[0]["studio_claims"] == [claim]
    finally:
        reopened.close()


@pytest.mark.parametrize(
    "case",
    [
        "unknown_record",
        "wrong_path",
        "wrong_range",
        "uppercase_hash",
        "nonhex_hash",
        "wrong_commit",
        "failed_read",
        "non_read_tool",
        "invalid_claim_status",
        "empty_claim_field",
        "empty_evidence",
        "empty_read_text",
        "fabricated_completeness",
    ],
)
def test_fabricated_or_malformed_source_linked_claim_is_not_persisted(tmp_path, case):
    store, mission_id, original = seeded_store(tmp_path)
    claim = copy.deepcopy(original)
    data = store.get(mission_id)

    if case == "unknown_record":
        claim["evidence"][0]["tool_result_id"] = "tool_ffffffffffffffff"
    elif case == "wrong_path":
        claim["evidence"][0]["path"] = "api/data/context.py"
    elif case == "wrong_range":
        claim["evidence"][0]["end"] = 11
    elif case == "uppercase_hash":
        claim["evidence"][0]["sha256"] = SOURCE_HASH.upper()
    elif case == "nonhex_hash":
        claim["evidence"][0]["sha256"] = "z" * 64
    elif case == "wrong_commit":
        claim["evidence"][0]["commit"] = "c" * 40
    elif case == "failed_read":
        data["tool_results"][0]["status"] = "blocked"
        store.save(data)
    elif case == "non_read_tool":
        data["tool_results"][0]["tool"] = "search_code"
        store.save(data)
    elif case == "invalid_claim_status":
        claim["status"] = "invalid"
    elif case == "empty_claim_field":
        claim["observation"] = "  "
    elif case == "empty_evidence":
        claim["evidence"] = []
    elif case == "empty_read_text":
        data["tool_results"][0]["result"]["text"] = ""
        store.save(data)
    elif case == "fabricated_completeness":
        claim["evidence"][0]["complete_file"] = False

    try:
        with pytest.raises(ValueError):
            store.artifact(
                mission_id,
                "data",
                "Fabricated claim",
                "Must not be saved",
                provenance_status="source_linked",
                studio_claims=[claim],
            )
        assert store.snapshot(mission_id)["artifacts"] == []
    finally:
        store.close()

    reopened = Store(tmp_path)
    try:
        assert reopened.snapshot(mission_id)["artifacts"] == []
    finally:
        reopened.close()


@pytest.mark.parametrize("provenance_status", ["none", "invalid"])
def test_unlinked_or_invalid_artifact_rejects_nonempty_claims(tmp_path, provenance_status):
    store, mission_id, claim = seeded_store(tmp_path)
    try:
        with pytest.raises(ValueError, match="Only source-linked artifacts"):
            store.artifact(
                mission_id,
                "review",
                "Review note",
                "Narrative only",
                provenance_status=provenance_status,
                studio_claims=[claim],
            )
        assert store.snapshot(mission_id)["artifacts"] == []

        artifact = store.artifact(
            mission_id,
            "review",
            "Review note",
            "Narrative only",
            provenance_status=provenance_status,
        )
        assert artifact["provenance_status"] == provenance_status
        assert artifact["studio_claims"] == []
    finally:
        store.close()


def test_absence_claim_requires_continuous_untruncated_full_file_coverage(tmp_path):
    store, mission_id, claim = seeded_store(tmp_path)
    try:
        data = store.get(mission_id)
        first = data["tool_results"][0]
        first["result"].update(
            end=6,
            text="lines one through six\n",
            line_truncated=True,
            text_truncated=False,
            complete_file=False,
        )
        second = copy.deepcopy(first)
        second.update(id="tool_fedcba9876543210", task_id="task_fedcba9876543210")
        second["result"].update(
            start=7,
            end=12,
            text="lines seven through twelve\n",
            line_truncated=False,
            complete_file=False,
        )
        data["tool_results"].append(second)
        store.save(data)

        first_evidence = claim["evidence"][0]
        first_evidence.update(
            end=6,
            line_truncated=True,
            complete_file=False,
        )
        with pytest.raises(ValueError, match="continuous full-file coverage"):
            store.artifact(
                mission_id,
                "data",
                "Incomplete absence claim",
                "Must not be saved",
                provenance_status="source_linked",
                studio_claims=[claim],
            )

        second_evidence = copy.deepcopy(first_evidence)
        second_evidence.update(
            tool_result_id=second["id"],
            task_id=second["task_id"],
            start=7,
            end=12,
            line_truncated=False,
        )
        claim["evidence"].append(second_evidence)
        artifact = store.artifact(
            mission_id,
            "data",
            "Complete absence claim",
            "Controller-rendered claim",
            provenance_status="source_linked",
            studio_claims=[claim],
        )
        assert len(artifact["studio_claims"][0]["evidence"]) == 2
    finally:
        store.close()


def test_present_claim_may_use_a_partial_untruncated_read(tmp_path):
    store, mission_id, claim = seeded_store(tmp_path)
    try:
        data = store.get(mission_id)
        data["tool_results"][0]["result"].update(
            start=4,
            end=7,
            text="filingDate = recent.get(...)\n",
            line_truncated=True,
            complete_file=False,
        )
        store.save(data)
        claim.update(
            field="Filing date",
            status="present",
            observation="The inspected lines read filingDate.",
        )
        claim["evidence"][0].update(
            start=4,
            end=7,
            line_truncated=True,
            complete_file=False,
        )
        artifact = store.artifact(
            mission_id,
            "data",
            "Present field",
            "Controller-rendered claim",
            provenance_status="source_linked",
            studio_claims=[claim],
        )
        assert artifact["provenance_status"] == "source_linked"
    finally:
        store.close()
