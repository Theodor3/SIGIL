"""Unmounted read-only factory. Explicit preparation and existing auth required."""
from fastapi import APIRouter, Depends, Response, Request, HTTPException
from api.research.recovered_daily import PreparedRecovery


async def require_recovery_session(request:Request):
    """Reuse dashboard sessions, but never the unauthenticated demo fallback."""
    from api.config.settings import settings
    from api.auth import verify_session
    if not settings.auth_password or not verify_session(request.cookies.get('sigil_session')):
        raise HTTPException(status_code=401,detail='unauthorized')
    origin=request.headers.get('origin')
    expected=f'{request.url.scheme}://{request.url.netloc}'
    if ((origin is not None and origin!=expected)
        or request.headers.get('sec-fetch-site') in ('cross-site','same-site')):
        raise HTTPException(status_code=401,detail='unauthorized')


def create_router(*, authorize=require_recovery_session, series=None, source_loader=None):
    if not callable(authorize) or (series is not None and not isinstance(series,PreparedRecovery)):
        raise ValueError('explicit_authorization_and_prepared_source_required')
    if source_loader is not None and (not callable(source_loader) or series is not None):
        raise ValueError('one_explicit_source_required')
    router=APIRouter(prefix='/api/portfolio',tags=['private recovered daily history'])

    @router.get('/recovered-daily',dependencies=[Depends(authorize)])
    def recovered_daily(response:Response):
        response.headers['Cache-Control']='no-store'
        response.headers['Pragma']='no-cache'
        selected = source_loader() if source_loader is not None else series
        return selected.response() if isinstance(selected,PreparedRecovery) else {'schema_version':1,'available':False,'reason':'not_configured'}

    return router
