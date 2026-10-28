import json

import httpx
import pytest
from pydantic import ValidationError

from swarm.local import LOCAL_MAX_OUTPUT_TOKENS, LOCAL_MODEL, LocalProvider
from swarm.models import LocalReport, Report
from swarm.providers import ProviderFailure
from swarm.store import Store


def payload(body_len=14000, summary_len=5000):
    return dict(summary='s'*summary_len, artifact_title='Synthetic longer report',
                artifact_body='b'*body_len, messages=[], sources=[], source_requests=[],
                tool_requests=[], studio_claims=[])


def test_long_report_survives_validation_and_store_roundtrip(tmp_path):
    report=LocalReport.model_validate(payload())
    store=Store(tmp_path)
    try:
        mid=store.create('Synthetic output boundary fixture', 'local')['id']
        store.artifact(mid, 'engineering', report.artifact_title, report.artifact_body)
        store.message(mid, 'engineering', 'coordinator', report.summary, 'finding')
        store.close()
        store=Store(tmp_path)
        result=store.snapshot(mid)
        assert result['artifacts'][0]['body']==report.artifact_body
        assert any(m['text']==report.summary for m in result['messages'])
    finally:
        store.close()


@pytest.mark.parametrize('field,limit', [('artifact_body',16000),('summary',6000)])
def test_report_exact_boundary_and_overflow(field,limit):
    data=payload(100,100)
    data[field]='x'*limit
    assert len(getattr(LocalReport.model_validate(data),field))==limit
    data[field]+='x'
    with pytest.raises(ValidationError): LocalReport.model_validate(data)


@pytest.mark.parametrize('overflow',[False,True])
def test_local_wire_budget_and_redacted_overflow(monkeypatch,overflow):
    real_client=httpx.Client
    data=payload(16001 if overflow else 14000,5000)
    if overflow: data['artifact_body']='PRIVATE_SYNTHETIC_MARKER'+data['artifact_body']
    def handle(request):
        wire=json.loads(request.content)
        assert wire['max_tokens']==LOCAL_MAX_OUTPUT_TOKENS==8192
        assert wire['response_format']['json_schema']['strict'] is True
        schema=wire['response_format']['json_schema']['schema']
        assert schema['properties']['artifact_body']['maxLength']==16000
        return httpx.Response(200,json={'model':LOCAL_MODEL,'choices':[{'finish_reason':'stop','message':{'content':json.dumps(data)}}],
                                       'usage':{'prompt_tokens':100,'completion_tokens':5000}})
    monkeypatch.setattr('swarm.local.httpx.Client',lambda **kw:real_client(transport=httpx.MockTransport(handle),**kw))
    provider=LocalProvider()
    if overflow:
        with pytest.raises(ProviderFailure) as error: provider.run('system','prompt',LocalReport)
        assert 'string_too_long' in str(error.value)
        assert 'fields=artifact_body' in str(error.value)
        assert 'PRIVATE_SYNTHETIC_MARKER' not in str(error.value)
        assert not provider.verified
    else:
        result=provider.run('system','prompt',LocalReport)
        assert LocalReport.model_validate_json(result.text).artifact_body==data['artifact_body']
        assert provider.verified


def test_cloud_contract_keeps_original_bounds():
    schema=Report.model_json_schema()
    assert schema["properties"]["summary"]["maxLength"]==2500
    assert schema["properties"]["artifact_body"]["maxLength"]==4000
    with pytest.raises(ValidationError): Report.model_validate(payload())


def test_local_larger_schema_retains_evidence_and_role_restrictions():
    from swarm.response_contract import response_schema
    visible='tool_0123456789abcdef'
    context=dict(your_current_source_evidence=[dict(id=visible,text='synthetic source',text_truncated=False)],
                 allowed_tools=['read_file'],allowed_recipients=['coordinator'],
                 mission_mode='local',independent_critique=True)
    schema=response_schema(LocalReport,json.dumps(context))
    assert schema['properties']['artifact_body']['maxLength']==16000
    assert schema['properties']['messages']['maxItems']==0
    assert schema['properties']['source_requests']['maxItems']==0
    assert schema['$defs']['ToolRequest']['properties']['tool']['enum']==['read_file']
    assert schema['$defs']['StudioClaim']['properties']['tool_result_ids']['items']['enum']==[visible]


def test_engine_local_selects_larger_schema_only_after_worker_rules(tmp_path):
    from swarm.engine import Engine
    from swarm.providers import Providers,ProviderResult
    class Fixture(Providers):
        def run(self,provider,system,prompt,schema):
            assert provider=='local'
            assert schema is LocalReport
            assert '6000 characters' in system and '16000 characters' in system
            assert 'For each claim based on Studio reads' in system
            return ProviderResult(json.dumps(payload()),100,5000,LOCAL_MODEL)
    store=Store(tmp_path)
    try:
        mid=store.create('Synthetic large local report','local')['id']
        engine=Engine(store,Fixture())
        report,_=engine._call(mid,'engineering','Synthetic test',Report)
        assert isinstance(report,LocalReport) and len(report.artifact_body)==14000
    finally:
        store.close()
