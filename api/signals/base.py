from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from api.data.context import PipelineContext


@dataclass
class SignalOutput:
    ticker: str
    score: float
    confidence: float
    metadata: dict = field(default_factory=dict)


class Signal(ABC):
    """Base class for all Sigil signals.

    To create a new signal:
    1. Copy template.py to a new file in this directory
    2. Implement name, version, default_weight, and compute()
    3. Add the weight to config/alpha_model.json
    4. The registry auto-discovers it on startup
    """

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def version(self) -> str: ...

    @property
    @abstractmethod
    def default_weight(self) -> float: ...

    @property
    def category(self) -> str:
        return "other"

    @property
    def description(self) -> str:
        return ""

    @property
    def tags(self) -> list[str]:
        return []

    @abstractmethod
    async def compute(self, ctx: PipelineContext) -> list[SignalOutput]:
        ...

    def describe(self) -> str:
        return self.description or f"{self.name} v{self.version}"

    def meta(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "weight": self.default_weight,
            "category": self.category,
            "description": self.description,
            "tags": self.tags,
        }
