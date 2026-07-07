"""Auth routes — login and session check."""
from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel

from api.auth import verify_password
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
async def check_auth():
    return {"auth_required": bool(settings.auth_password)}
