from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

HARNESS_SCHEMA_VERSION = 1
HARNESS_PRODUCER_VERSION = "0.1.0"
FIXTURE_ADAPTER_ID = "fixture-agent-v1"
AGENT_IDS = ("agent-1", "agent-2", "agent-3")


@dataclass(frozen=True)
class HarnessPaths:
    root: Path

    @property
    def declared(self) -> Path:
        return self.root / "declared"

    @property
    def attempts(self) -> Path:
        return self.root / "attempts"

    @property
    def digest_store(self) -> Path:
        return self.root / "by-digest"

    @property
    def current(self) -> Path:
        return self.root / "current.json"


PATHS = HarnessPaths(Path("artifacts/harness"))
