"""Simple in-memory TTL cache for dashboard data."""
from __future__ import annotations

import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}


def get(key: str) -> Any | None:
    entry = _store.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _store.pop(key, None)
        return None
    return value


def set(key: str, value: Any, ttl: int = 60) -> None:
    _store[key] = (time.monotonic() + ttl, value)


def invalidate(key: str) -> None:
    _store.pop(key, None)


def invalidate_prefix(prefix: str) -> None:
    keys = [k for k in _store if k.startswith(prefix)]
    for k in keys:
        _store.pop(k, None)


def clear() -> None:
    _store.clear()
