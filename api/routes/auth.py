"""Auth routes — login and session check."""
from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from api.auth import verify_password, verify_session
from api.config.settings import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    if not settings.auth_password:
        return {"authenticated": True, "session": None}

    session_id = verify_password(body.password)
    if session_id:
        from api.auth import SESSION_SECONDS
        response.set_cookie(
            "sigil_session", session_id,
            httponly=True, samesite="lax", max_age=SESSION_SECONDS,
        )
        return {"authenticated": True}
    return {"authenticated": False, "error": "Invalid password"}


@router.get("/check")
async def check_auth(request: Request):
    """Reports both whether auth is required AND whether the caller's
    existing session cookie is already valid — without the second half the
    login gate can't know a refresh is already authenticated."""
    return {
        "auth_required": bool(settings.auth_password),
        "authenticated": verify_session(request.cookies.get("sigil_session")),
    }
