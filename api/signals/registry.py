from __future__ import annotations

import importlib
import pkgutil
from typing import TYPE_CHECKING

from api.signals.base import Signal

if TYPE_CHECKING:
    pass

_registry: dict[str, Signal] = {}


def discover_signals() -> dict[str, Signal]:
    """Import all modules in the signals package and collect Signal subclasses."""
    import api.signals as pkg

    for info in pkgutil.iter_modules(pkg.__path__):
        if info.name in ("base", "registry", "template"):
            continue
        module = importlib.import_module(f"api.signals.{info.name}")
        for attr_name in dir(module):
            attr = getattr(module, attr_name)
            if (
                isinstance(attr, type)
                and issubclass(attr, Signal)
                and attr is not Signal
            ):
                instance = attr()
                _registry[instance.name] = instance

    return _registry


def get_registry() -> dict[str, Signal]:
    if not _registry:
        discover_signals()
    return _registry
