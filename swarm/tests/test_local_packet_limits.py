import pytest
from pydantic import ValidationError
from swarm.models import Assignment,LocalAssignment,LocalReport,Report,NewMission
from swarm.store import Store
def test_local_input_capacity_and_other_contracts(tmp_path):
    text='e'*6000
    assert LocalAssignment(agent_id='quant',task=text).task==text
    assert NewMission(mode='local',prompt=text).prompt==text
    with pytest.raises(ValidationError):LocalAssignment(agent_id='quant',task=text+'e')
    with pytest.raises(ValidationError):Assignment(agent_id='quant',task='e'*2001)
    store=Store(tmp_path)
    assert store.snapshot(store.create(text,'local')['id'])['mission']['prompt']==text
    with pytest.raises(ValueError):store.create(text+'e','local')
    with pytest.raises(ValueError):store.create('e'*2001,'subscription')
    store.close()
def test_artifacts_expand_local_only_without_truncation():
    packet=dict(summary='Evidence',artifact_title='Full artifact',artifact_body='e'*32000,messages=[],sources=[],source_requests=[],tool_requests=[],studio_claims=[])
    assert len(LocalReport.model_validate(packet).artifact_body)==32000
    with pytest.raises(ValidationError):LocalReport.model_validate({**packet,'artifact_body':'e'*32001})
    with pytest.raises(ValidationError):Report.model_validate(packet)

def test_long_packet_reaches_both_local_contexts_without_slicing(tmp_path):
    from swarm.tests.test_local import LocalFixture
    from swarm.engine import Engine
    from swarm.studio import GitStudio
    from pathlib import Path
    text='START_SENTINEL '+('source evidence '*300)+' END_SENTINEL'
    assert 2000<len(text)<6000
    store=Store(tmp_path);provider=LocalFixture()
    engine=Engine(store,provider,studio=GitStudio(Path(__file__).resolve().parents[2]))
    mission=store.create(text,'local');engine.start(mission['id']);engine.thread.join(10)
    assert not engine.thread.is_alive()
    assert len(provider.calls)==2
    assert all(packet['mission']==text for _,packet in provider.calls)
    assert provider.calls[0][1]['your_task']==text
    assert store.snapshot(mission['id'])['mission']['status']=='needs_review'
    store.close()
