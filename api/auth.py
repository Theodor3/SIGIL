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

# The read-only export for external agents. Everything under it is reachable with
# the agent token instead of a session cookie -- and only ever by reading.
AGENT_PREFIX = "/api/agent/"


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


def _agent_request_authorized(request: Request) -> bool:
    """True for a read-only agent-export request carrying the agent token.

    Three conditions, all required: the token is configured, the request is a read
    under AGENT_PREFIX, and the bearer value matches. The method and prefix checks
    are what keep this from becoming a second way in -- a leaked token can re-read
    the target book and cannot reach a single state-changing endpoint.

    Compared as bytes because hmac.compare_digest rejects str containing non-ASCII,
    which would raise on a token pasted with a stray unicode character rather than
    simply failing the check.
    """
    if not settings.agent_token:
        return False
    if request.method not in ("GET", "HEAD"):
        return False
    if not request.url.path.startswith(AGENT_PREFIX):
        return False
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not value:
        return False
    return hmac.compare_digest(value.encode(), settings.agent_token.encode())


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.auth_password:
            return await call_next(request)

        path = request.url.path

        if path in PUBLIC_PATHS or path.startswith("/assets"):
            return await call_next(request)

        if _agent_request_authorized(request):
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


def verify_session(token: str | None) -> bool:
    """True when the given session cookie value is valid and unexpired."""
    if not settings.auth_password:
        return True
    return bool(token) and _verify_token(token)


def verify_password(password: str) -> str | None:
    if not settings.auth_password:
        return None
    if hmac.compare_digest(password, settings.auth_password):
        return _sign(int(time.time()) + SESSION_SECONDS)
    return None
