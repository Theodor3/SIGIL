import asyncio
import hashlib
import json

import httpx
from fastapi import FastAPI, HTTPException

from api.research.recovery_files import load_recovery
from api.routes.recovered_daily import create_router
from recovery_fixture import fixture


def write_packet(root):
    view, raw = fixture()
    receipt = dict(paper_account_match=True,
        endpoint='https://paper-api.alpaca.markets/v2/account/portfolio/history',
        sha256=hashlib.sha256(raw).hexdigest(), query={'timeframe':'1D'},
        account_fingerprint='b'*64, retrieved_at=view['retrieved_at'])
    for name, value in [('view.json',json.dumps(view)), ('source.json',raw.decode()),
                        ('receipt.json',json.dumps(receipt)), ('account-binding.txt','b'*64)]:
        (root/name).write_text(value)


def test_missing_corrupt_oversized_and_wrong_binding_stay_unavailable(tmp_path):
    assert load_recovery(tmp_path) is None
    write_packet(tmp_path)
    assert load_recovery(tmp_path).response()['available']
    (tmp_path/'account-binding.txt').write_text('c'*64)
    assert load_recovery(tmp_path) is None
    write_packet(tmp_path)
    (tmp_path/'source.json').write_text('[')
    assert load_recovery(tmp_path) is None
    (tmp_path/'source.json').write_bytes(b' '*256001)
    assert load_recovery(tmp_path) is None


def test_auth_runs_before_private_reads_and_loader_is_not_called_at_startup():
    reads=[]
    def loader():
        reads.append(True)
        return None
    async def denied(): raise HTTPException(401)
    async def allowed(): pass
    async def run():
        for auth, expected in [(denied,401),(allowed,200)]:
            app=FastAPI();app.include_router(create_router(authorize=auth,source_loader=loader))
            async with app.router.lifespan_context(app):
                assert not reads
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                    response=await client.get('/api/portfolio/recovered-daily')
                    assert response.status_code==expected
                    if expected==200:
                        assert response.headers['cache-control']=='no-store'
                        assert response.json()['available'] is False
        assert len(reads)==1
    asyncio.run(run())
