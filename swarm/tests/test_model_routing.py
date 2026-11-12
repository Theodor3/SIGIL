import json
import pytest
from pydantic import ValidationError
from swarm.models import Assignment,Report,GEMINI_MODEL,GEMINI_FLASH_MODEL,gemini_model_for
from swarm.providers import Providers,ProviderResult
from swarm.store import Store
from swarm.engine import Engine
def test_role_and_complexity_policy():
    assert gemini_model_for('data')==GEMINI_FLASH_MODEL
    assert gemini_model_for('product-ops')==GEMINI_FLASH_MODEL
    for role in ('quant','engineering','research-events','research-frontier','review'):
        assert gemini_model_for(role)==GEMINI_MODEL
    assert gemini_model_for('engineering','routine')==GEMINI_FLASH_MODEL
    assert gemini_model_for('data','complex')==GEMINI_MODEL
    assert gemini_model_for('review','routine')==GEMINI_MODEL
    with pytest.raises(ValidationError):Assignment(agent_id='data',task='x',complexity='free')
    with pytest.raises(ValueError):gemini_model_for('data','free')
def test_model_specific_cost_and_reservation():
    p=Providers();r=ProviderResult('',1000,1000,GEMINI_FLASH_MODEL)
    assert r.cost('gemini',model=GEMINI_FLASH_MODEL)==.00175
    assert r.cost('gemini',model=GEMINI_MODEL)==.014
    assert p.reservation('gemini','x','y',Report,model=GEMINI_FLASH_MODEL)<p.reservation('gemini','x','y',Report,model=GEMINI_MODEL)/7
    with pytest.raises(ValueError):p.reservation('gemini','x','y',Report,model='unpriced-model')
def test_selected_model_binds_ledger_request_and_cost(tmp_path):
    class Fixture(Providers):
        def run(self,provider,system,prompt,schema,*,model=None):
            assert model==GEMINI_FLASH_MODEL
            return ProviderResult(json.dumps(dict(summary='Source extraction',artifact_title='Values',artifact_body='Observed values',messages=[],sources=[],source_requests=[],tool_requests=[],studio_claims=[])),1000,1000,model)
    store=Store(tmp_path)
    mid=store.create('Synthetic routing fixture','live')['id'];store.settings['expires_on']='2099-01-01'
    p=Fixture();Engine(store,p)._call(mid,'data','Extract supplied values',Report,complexity='routine')
    row=store.ledger[-1]
    assert row['model']==row['returned_model']==row['request_profile']['planned_model']==GEMINI_FLASH_MODEL
    assert row['request_profile']['rates_per_million']==(.25,1.5)
    assert row['cost_usd']==.00175
    assert row['usage']['input_tokens']==1000
    store.close()

def test_openai_plan_and_verdict_wire_require_explicit_complexity():
    from swarm.models import Plan,Verdict
    from swarm.response_contract import response_schema
    for schema in (Plan,Verdict):
        wire=response_schema(schema,'task',provider='openai')
        assignment=wire['$defs']['Assignment']
        assert set(assignment['required'])==set(assignment['properties'])
        assert 'default' not in assignment['properties']['complexity']
        assert assignment['additionalProperties'] is False
    assert Assignment(agent_id='data',task='Old record').complexity=='auto'
