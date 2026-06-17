"""Simple auth gate — password protection for the dashboard."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from api.config.settings import settings

_sessions: dict[str, datetime] = {}
SESSION_DURATION = timedelta(hours=24)

PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/check"}


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.auth_password:
            return await call_next(request)

        path = request.url.path

        if path in PUBLIC_PATHS or path.startswith("/assets"):
            return await call_next(request)

        # Check session cookie
        session_id = request.cookies.get("sigil_session")
        if session_id and session_id in _sessions:
            if datetime.utcnow() < _sessions[session_id]:
                return await call_next(request)
            else:
                del _sessions[session_id]

        # For API requests, return 401
        if path.startswith("/api") or path.startswith("/ws"):
            return Response(status_code=401, content='{"error":"unauthorized"}',
                            media_type="application/json")

        # For page requests, serve the app (it handles the login screen)
        return await call_next(request)


def verify_password(password: str) -> str | None:
    if not settings.auth_password:
        return None
    if password == settings.auth_password:
        session_id = secrets.token_urlsafe(32)
        _sessions[session_id] = datetime.utcnow() + SESSION_DURATION
        return session_id
    return None


def cleanup_sessions():
    now = datetime.utcnow()
    expired = [sid for sid, exp in _sessions.items() if now >= exp]
    for sid in expired:
        del _sessions[sid]
