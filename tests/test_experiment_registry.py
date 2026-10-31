import json

import pytest

from swarm.experiments import read_experiments


def registry(tmp_path, **changes):
    item = dict(id="EXP-001", title="A hypothesis", type="company_research", ticker="CSX",
                stage="feasibility", status="ready", hypothesisVersion="draft-1",
                hypothesis="Untested", createdAt="2026-10-04", nextAction="Audit data",
                sourceSamples=9, originalPublicationTimesVerified=False,
                predictiveResultsAvailable=False, findings=[dict(id="F001", status="unresolved", summary="Timing")],
                evidenceReport="private/local/path", runtimeDispatchEnabled=True,
                paperTrial={"private": "not a public result"})
    item.update(changes)
    path = tmp_path / ".swarm" / "experiments.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(dict(schemaVersion=1, experiments=[item])))
    return path


def test_projects_only_public_fields_and_remains_read_only(tmp_path):
    path = registry(tmp_path)
    before = path.read_bytes()
    result = read_experiments(tmp_path)
    assert result["readOnly"] is True
    assert result["experiments"][0]["sourceSamples"] == 9
    assert result["experiments"][0]["findings"][0]["status"] == "unresolved"
    assert "private" not in json.dumps(result)
    assert "runtimeDispatchEnabled" not in json.dumps(result)
    assert "paperTrial" not in json.dumps(result)
    assert path.read_bytes() == before


@pytest.mark.parametrize("changes", [dict(sourceSamples=-1), dict(sourceSamples=True),
    dict(originalPublicationTimesVerified="false"), dict(findings=None), dict(title=17)])
def test_rejects_invalid_records_without_echoing_values(tmp_path, changes):
    registry(tmp_path, **changes)
    with pytest.raises(ValueError, match="^The experiment registry is unavailable or invalid.$"):
        read_experiments(tmp_path)


@pytest.mark.parametrize("payload", ["{", "[]", '{"schemaVersion":2,"experiments":[]}',
    '{"schemaVersion":true,"experiments":[]}'])
def test_corrupt_or_unknown_registry_is_not_an_empty_success(tmp_path, payload):
    path = registry(tmp_path)
    path.write_text(payload)
    with pytest.raises(ValueError):
        read_experiments(tmp_path)


def test_missing_and_duplicate_registry_fail(tmp_path):
    with pytest.raises(ValueError):
        read_experiments(tmp_path)
    path = registry(tmp_path)
    data = json.loads(path.read_text())
    data["experiments"] *= 2
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError):
        read_experiments(tmp_path)


def test_reads_updates_and_accepts_explicit_empty_registry(tmp_path):
    path = registry(tmp_path)
    assert read_experiments(tmp_path)["experiments"]
    path.write_text('{"schemaVersion":1,"experiments":[]}')
    assert read_experiments(tmp_path)["experiments"] == []

@pytest.mark.parametrize("value", ["nonsense", "2026-02-30", "2026-10-30T12:00:00", "2026-10-30T24:00:00Z"])
def test_registry_timestamp_rejects_invalid_and_naive(tmp_path,value):
    registry(tmp_path,createdAt=value)
    with pytest.raises(ValueError):read_experiments(tmp_path)

def test_registry_preserves_date_precision_and_decision(tmp_path):
    registry(tmp_path,decisionAt="2026-10-29T21:48:45.429293+00:00")
    x=read_experiments(tmp_path)["experiments"][0]
    assert x["createdAt"]=="2026-10-04"
    assert x["decisionAt"]=="2026-10-29T21:48:45.429293+00:00"
