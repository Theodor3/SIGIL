import asyncio
import hashlib
import json
import httpx
import pytest
from fastapi import FastAPI,HTTPException,Request
from api.research.recovered_daily import PreparedRecovery
from api.routes.recovered_daily import create_router


from recovery_fixture import fixture


def prepare(view,raw,**overrides):
    receipt=dict(paper_account_match=True,endpoint='https://paper-api.alpaca.markets/v2/account/portfolio/history',
        sha256=hashlib.sha256(raw).hexdigest(),query={'timeframe':'1D'},account_fingerprint='b'*64,retrieved_at=view['retrieved_at'])
    receipt.update(overrides)
    return PreparedRecovery(json.dumps(view).encode(),raw,receipt=receipt,expected_account_fingerprint='b'*64)


def test_source_binding_separate_series_whitelist_and_detached_responses():
    view,raw=fixture();series=prepare(view,raw)
    response=series.response()
    assert response['points'][0]['provider_label_utc']=='2026-10-10T00:00:00+00:00'
    assert response['points'][0]['valuation_at'] is None
    assert response['comparison_allowed'] is False and response['separate_from_hourly'] is True
    assert 'not_to_serve' not in str(response)
    response['points'][0]['equity']=999
    assert series.response()['points'][0]['equity']==100


@pytest.mark.parametrize('change',[lambda p:p.update(equity=999),lambda p:p.update(date_index='2026-10-10'),
 lambda p:p.update(valuation_at='2026-10-09T20:00:00Z'),lambda p:p.update(resolution='hourly')])
def test_corrupt_or_invented_fields_reject(change):
    view,raw=fixture();change(view['points'][0])
    with pytest.raises(ValueError):prepare(view,raw)


def test_duplicates_and_wrong_raw_source_reject():
    view,raw=fixture();view['points']*=2
    with pytest.raises(ValueError):prepare(view,raw)
    view,raw=fixture()
    with pytest.raises(ValueError):prepare(view,b'{}')


def test_isolated_route_auth_no_store_disabled_compatibility_and_unchanged_hourly():
    async def auth(request:Request):
        if request.headers.get('x-test-auth')!='allowed':raise HTTPException(401)
    async def run(series):
        app=FastAPI();app.include_router(create_router(authorize=auth,series=series))
        @app.get('/api/portfolio/equity-history')
        async def hourly():return {'points':[{'t':'fixture','equity':7}],'stats':None}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
            assert (await c.get('/api/portfolio/recovered-daily')).status_code==401
            response=await c.get('/api/portfolio/recovered-daily',headers={'x-test-auth':'allowed'})
            assert response.headers['cache-control']=='no-store'
            assert response.json()['available']==(series is not None)
            assert (await c.get('/api/portfolio/equity-history')).json()=={'points':[{'t':'fixture','equity':7}],'stats':None}
            assert (await c.post('/api/portfolio/recovered-daily')).status_code==405
    view,raw=fixture()
    asyncio.run(run(prepare(view,raw)))
    asyncio.run(run(None))


@pytest.mark.parametrize('overrides',[dict(paper_account_match=False),dict(account_fingerprint='c'*64),
    dict(endpoint='https://api.alpaca.markets/v2/account/portfolio/history'),dict(retrieved_at='2026-11-03T16:00:00Z')])
def test_account_environment_and_receipt_binding_reject(overrides):
    view,raw=fixture()
    with pytest.raises(ValueError):prepare(view,raw,**overrides)


def test_actual_dashboard_session_gate_denies_demo_agent_and_expired_sessions(monkeypatch):
    import time
    from api.config.settings import settings
    from api.auth import AuthMiddleware,_sign
    view,raw=fixture();series=prepare(view,raw)
    async def run(password):
        monkeypatch.setattr(settings,'auth_password',password)
        monkeypatch.setattr(settings,'agent_token','offline-agent-fixture')
        app=FastAPI();app.add_middleware(AuthMiddleware);app.include_router(create_router(series=series))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://offline') as c:
            assert (await c.get('/api/portfolio/recovered-daily')).status_code==401
            assert (await c.get('/api/portfolio/recovered-daily',headers={'Authorization':'Bearer offline-agent-fixture'})).status_code==401
            c.cookies.set('sigil_session',_sign(int(time.time())-10))
            assert (await c.get('/api/portfolio/recovered-daily')).status_code==401
            c.cookies.set('sigil_session',_sign(int(time.time())+60))
            response=await c.get('/api/portfolio/recovered-daily')
            assert response.status_code==(200 if password else 401)
            if password:
                assert (await c.get('/api/portfolio/recovered-daily',headers={'Origin':'http://other-origin'})).status_code==401
                assert (await c.get('/api/portfolio/recovered-daily',headers={'Sec-Fetch-Site':'same-site'})).status_code==401
                assert (await c.get('/api/portfolio/recovered-daily',headers={'Origin':'http://offline','Sec-Fetch-Site':'same-origin'})).status_code==200
    asyncio.run(run('offline-fixture-password-not-a-real-credential'))
    asyncio.run(run(''))
