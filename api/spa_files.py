"""Resolve SPA files without allowing URL paths to escape the asset root."""
from pathlib import Path


def public_file(root: Path, requested: str):
    base = root.resolve()
    target = (base / requested).resolve()
    if not target.is_relative_to(base):
        return None
    return target if target.is_file() else None
