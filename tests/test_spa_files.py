import asyncio
import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from api.spa_files import public_file


def test_traversal_absolute_and_symlink_paths_cannot_escape(tmp_path):
    root=tmp_path/'dist';root.mkdir()
    (root/'index.html').write_text('public fixture')
    private=tmp_path/'private.json';private.write_text('private fixture')
    assert public_file(root,'index.html')==root/'index.html'
    assert public_file(root,'../private.json') is None
    assert public_file(root,str(private)) is None
    (root/'link.json').symlink_to(private)
    assert public_file(root,'link.json') is None


def test_encoded_traversal_in_actual_fastapi_path_resolution(tmp_path):
    root=tmp_path/'dist';root.mkdir()
    (root/'index.html').write_text('public fixture')
    (tmp_path/'private.json').write_text('private fixture')
    app=FastAPI()
    @app.get('/{path:path}')
    async def spa(path:str):
        return FileResponse(public_file(root,path) or root/'index.html')
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture') as client:
            for path in ['/%2e%2e/private.json','/..%2fprivate.json','/%2e%2e%2fprivate.json','/%2fprivate.json']:
                response=await client.get(path)
                assert response.status_code==200
                assert response.text=='public fixture'
    asyncio.run(run())
