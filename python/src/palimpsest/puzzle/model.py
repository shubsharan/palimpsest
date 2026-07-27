from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

AGENT_IDS = ("agent-1", "agent-2", "agent-3")
STAGE_COUNT = 6
DEFAULT_TRANSITION_STAGE = 4

AgentId = Literal["agent-1", "agent-2", "agent-3"]
Regime = Literal["base", "revised"]
SourceKind = Literal["private-ciphertext", "plaintext"]
MatchKind = Literal["exact", "normalized"]

_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def _assert_relative_path(path: Path, name: str) -> None:
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"{name} must be a safe relative path.")


@dataclass(frozen=True)
class EvidenceStage:
    agent_id: AgentId
    ordinal: int
    release_offset_ms: int
    source_path: Path
    token_count: int
    sha256: str
    regime: Regime | None = None

    def __post_init__(self) -> None:
        if self.agent_id not in AGENT_IDS:
            raise ValueError(f"Unknown puzzle agent: {self.agent_id}.")
        if not 1 <= self.ordinal <= STAGE_COUNT:
            raise ValueError(f"Stage ordinal must be between 1 and {STAGE_COUNT}.")
        if self.release_offset_ms < 0:
            raise ValueError("Stage release offset must be non-negative.")
        _assert_relative_path(self.source_path, "Stage source path")
        if self.token_count < 1:
            raise ValueError("Every evidence stage must contain at least one word token.")
        if _DIGEST.fullmatch(self.sha256) is None:
            raise ValueError("Stage digest must be lowercase SHA-256.")
        if self.regime is not None and self.regime not in {"base", "revised"}:
            raise ValueError("Stage regime must be base or revised.")

    def to_dict(self, *, transition_stage: int = DEFAULT_TRANSITION_STAGE) -> dict[str, Any]:
        regime = self.regime or ("base" if self.ordinal < transition_stage else "revised")
        return {
            "agentId": self.agent_id,
            "ordinal": self.ordinal,
            "releaseOffsetMs": self.release_offset_ms,
            "sourcePath": self.source_path.as_posix(),
            "tokenCount": self.token_count,
            "sha256": self.sha256,
            "regime": regime,
        }


@dataclass(frozen=True)
class PuzzleBuild:
    build_id: str
    stage_interval_ms: int
    transition_stage: int
    changed_symbols: tuple[str, ...]
    public_ciphertext_path: Path
    reference_corpus_path: Path
    oracle_root: Path
    stages: tuple[EvidenceStage, ...]

    def __post_init__(self) -> None:
        if not self.build_id.startswith("build-") or _DIGEST.fullmatch(self.build_id[6:]) is None:
            raise ValueError("Build ID must contain a lowercase SHA-256 digest.")
        if self.stage_interval_ms < 1:
            raise ValueError("Stage interval must be positive.")
        if not 2 <= self.transition_stage <= STAGE_COUNT:
            raise ValueError("Transition stage must leave both base and revised evidence.")
        if not self.changed_symbols or len(set(self.changed_symbols)) != len(self.changed_symbols):
            raise ValueError("Changed symbols must be non-empty and unique.")
        if tuple(sorted(self.changed_symbols)) != self.changed_symbols:
            raise ValueError("Changed symbols must use deterministic sorted order.")
        for path, name in (
            (self.public_ciphertext_path, "Public ciphertext path"),
            (self.reference_corpus_path, "Reference corpus path"),
            (self.oracle_root, "Oracle root"),
        ):
            _assert_relative_path(path, name)

        for agent_id in AGENT_IDS:
            stream = sorted(
                (stage for stage in self.stages if stage.agent_id == agent_id),
                key=lambda stage: stage.ordinal,
            )
            if [stage.ordinal for stage in stream] != list(range(1, STAGE_COUNT + 1)):
                raise ValueError(f"{agent_id} must contain exactly six ordered stages.")
            for stage in stream:
                expected_offset = (stage.ordinal - 1) * self.stage_interval_ms
                expected_regime = "base" if stage.ordinal < self.transition_stage else "revised"
                if stage.release_offset_ms != expected_offset:
                    raise ValueError("Stage release offsets must follow the configured interval.")
                if stage.regime is not None and stage.regime != expected_regime:
                    raise ValueError("Stage regime does not match the shared transition.")
        if len(self.stages) != len(AGENT_IDS) * STAGE_COUNT:
            raise ValueError("Puzzle build must contain exactly three six-stage streams.")

    @property
    def agent_count(self) -> int:
        return len(AGENT_IDS)

    @property
    def stage_count(self) -> int:
        return STAGE_COUNT

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "buildId": self.build_id,
            "agentCount": self.agent_count,
            "stageCount": self.stage_count,
            "transitionStage": self.transition_stage,
            "stageIntervalMs": self.stage_interval_ms,
            "changedSymbols": list(self.changed_symbols),
            "publicCiphertextPath": self.public_ciphertext_path.as_posix(),
            "referenceCorpusPath": self.reference_corpus_path.as_posix(),
            "privateStageRoots": {agent_id: f"private/{agent_id}/stages" for agent_id in AGENT_IDS},
            "oracleRoot": self.oracle_root.as_posix(),
            "stages": [
                stage.to_dict(transition_stage=self.transition_stage)
                for stage in sorted(self.stages, key=lambda item: (item.agent_id, item.ordinal))
            ],
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> PuzzleBuild:
        if value.get("schemaVersion") != 1:
            raise ValueError("Unsupported puzzle build schema version.")
        raw_stages = value.get("stages")
        if not isinstance(raw_stages, list):
            raise ValueError("Puzzle build stages must be an array.")
        stages = tuple(
            EvidenceStage(
                agent_id=stage["agentId"],
                ordinal=stage["ordinal"],
                release_offset_ms=stage["releaseOffsetMs"],
                source_path=Path(stage["sourcePath"]),
                token_count=stage["tokenCount"],
                sha256=stage["sha256"],
                regime=stage["regime"],
            )
            for stage in raw_stages
        )
        return cls(
            build_id=value["buildId"],
            stage_interval_ms=value["stageIntervalMs"],
            transition_stage=value["transitionStage"],
            changed_symbols=tuple(value["changedSymbols"]),
            public_ciphertext_path=Path(value["publicCiphertextPath"]),
            reference_corpus_path=Path(value["referenceCorpusPath"]),
            oracle_root=Path(value["oracleRoot"]),
            stages=stages,
        )


@dataclass(frozen=True)
class AggregateScore:
    matched_words: int
    total_words: int
    coverage: float
    accuracy: float

    def __post_init__(self) -> None:
        if (
            isinstance(self.matched_words, bool)
            or isinstance(self.total_words, bool)
            or not isinstance(self.matched_words, int)
            or not isinstance(self.total_words, int)
            or self.matched_words < 0
            or self.total_words < 0
            or self.matched_words > self.total_words
        ):
            raise ValueError("Aggregate word counts are invalid.")
        if not 0.0 <= self.coverage <= 1.0 or not 0.0 <= self.accuracy <= 1.0:
            raise ValueError("Aggregate coverage and accuracy must be bounded.")

    def to_dict(self) -> dict[str, int | float]:
        return {
            "matchedWords": self.matched_words,
            "totalWords": self.total_words,
            "coverage": self.coverage,
            "accuracy": self.accuracy,
        }


@dataclass(frozen=True)
class OverlapFinding:
    committed_path: str
    source_kind: SourceKind
    source_id: str
    match_kind: MatchKind
    word_count: int
    sha256: str

    def __post_init__(self) -> None:
        if not self.committed_path or not self.source_id:
            raise ValueError("Overlap finding paths and source identities must be non-empty.")
        if self.word_count < 1 or _DIGEST.fullmatch(self.sha256) is None:
            raise ValueError("Overlap finding span evidence is invalid.")

    def to_dict(self) -> dict[str, str | int]:
        return {
            "committedPath": self.committed_path,
            "sourceKind": self.source_kind,
            "sourceId": self.source_id,
            "matchKind": self.match_kind,
            "wordCount": self.word_count,
            "sha256": self.sha256,
        }
