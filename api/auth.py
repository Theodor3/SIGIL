"""Simple auth gate — password protection for the dashboard.

Sessions are stateless signed tokens (expiry + HMAC) rather than server-side
state, so logins survive restarts and deploys — with in-memory sessions every
deploy logged all users out.
"""
from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from api.config.settings import settings

SESSION_SECONDS = 7 * 24 * 3600

PUBLIC_PATHS = {"/health", "/api/auth/login", "/api/auth/check"}


def _signing_key() -> bytes:
    # Derived from the auth password: rotating the password invalidates
    # every outstanding session token.
    return hashlib.sha256(f"sigil-session:{settings.auth_password}".encode()).digest()


def _sign(expiry: int) -> str:
    sig = hmac.new(_signing_key(), str(expiry).encode(), hashlib.sha256).hexdigest()
    return f"{expiry}.{sig}"


def _verify_token(token: str) -> bool:
    try:
        expiry_str, sig = token.split(".", 1)
        expiry = int(expiry_str)
    except (ValueError, AttributeError):
        return False
    if time.time() > expiry:
        return False
    expected = hmac.new(_signing_key(), expiry_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.auth_password:
            return await call_next(request)

        path = request.url.path

        if path in PUBLIC_PATHS or path.startswith("/assets"):
            return await call_next(request)

        token = request.cookies.get("sigil_session")
        if token and _verify_token(token):
            return await call_next(request)

        # For API requests, return 401
        if path.startswith("/api") or path.startswith("/ws"):
            return Response(status_code=401, content='{"error":"unauthorized"}',
                            media_type="application/json")

        # For page requests, serve the app (it handles the login screen)
        return await call_next(request)


def verify_password(password: str) -> str | None:
    if not settings.auth_password:
        return None
    if hmac.compare_digest(password, settings.auth_password):
        return _sign(int(time.time()) + SESSION_SECONDS)
    return None
