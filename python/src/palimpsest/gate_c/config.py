from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

GATE_C_PROFILE = "partial-rekey-literary-v1"
INSTANCE_ID = "revision-amber"
SOURCE_ID = "middlemarch"
SOURCE_PATH = Path("artifacts/gate-a/inputs/sources/middlemarch.txt")
ENTITY_REVIEW_PATH = Path("artifacts/gate-b/inputs/entity-review/instance-amber.json")
SOURCE_FORMAT = "gutenberg-text"
SEED_HEX = "44" * 32
START_CHAPTER = 10
SWITCH_AFTER_CHAPTER = 12
END_CHAPTER = 15
TARGET_TOKEN_COUNT = 27_504
MIN_SEGMENT_TOKENS = 10_000
MIN_OCCURRENCES_PER_SEGMENT = 8
FREQUENCY_STRATA = 4
CHANGED_TOKEN_MASS_TARGET = 0.20
CONTRADICTION_MASS_THRESHOLD = 0.25
REVEAL_SLOT_COUNT = 6
REVEAL_INTERVAL_MS = 120_000
REVEAL_EARLY_TOLERANCE_MS = 0
REVEAL_LATE_TOLERANCE_MS = 1_000
FRONTIER_RESPONSE_TIMEOUT_MS = 110_000
FRONTIER_MODEL = "gpt-5.6-sol"


@dataclass(frozen=True)
class GateCPaths:
    root: Path

    @property
    def calibration(self) -> Path:
        return self.root / "calibration"

    @property
    def attempts(self) -> Path:
        return self.root / "attempts"

    @property
    def digest_store(self) -> Path:
        return self.root / "by-digest"

    @property
    def current(self) -> Path:
        return self.root / "current.json"


PATHS = GateCPaths(Path("artifacts/gate-c"))
