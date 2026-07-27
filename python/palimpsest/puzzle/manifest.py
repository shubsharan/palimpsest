from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Literal

AGENT_IDS = ("agent-1", "agent-2", "agent-3")
STAGE_COUNT = 6
DEFAULT_TRANSITION_STAGE = 4

AgentId = Literal["agent-1", "agent-2", "agent-3"]
Regime = Literal["base", "revised"]

_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def _record(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object.")
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _required(record: dict[str, object], field: str, name: str) -> object:
    if field not in record:
        raise ValueError(f"{name} {field} is required.")
    return record[field]


def _integer(value: object, name: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer of at least {minimum}.")
    return value


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
    return value


def _relative_path(value: object, name: str) -> Path:
    source = _string(value, name)
    posix = PurePosixPath(source)
    windows = PureWindowsPath(source)
    parts = re.split(r"[\\/]", source)
    if (
        "\0" in source
        or posix.is_absolute()
        or windows.is_absolute()
        or bool(windows.drive)
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError(f"{name} must be a safe relative path.")
    return Path(source)


def _agent_id(value: object, name: str) -> AgentId:
    if value == "agent-1" or value == "agent-2" or value == "agent-3":
        return value
    raise ValueError(f"{name} must identify one declared agent.")


def _regime(value: object, name: str) -> Regime:
    if value == "base" or value == "revised":
        return value
    raise ValueError(f"{name} must be base or revised.")


def _assert_relative_path(path: Path, name: str) -> None:
    _relative_path(path.as_posix(), name)


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

    @classmethod
    def from_dict(cls, value: object, *, name: str = "Evidence stage") -> EvidenceStage:
        stage = _record(value, name)
        agent_id = _agent_id(_required(stage, "agentId", name), f"{name} agentId")
        ordinal = _integer(_required(stage, "ordinal", name), f"{name} ordinal", 1)
        release_offset_ms = _integer(
            _required(stage, "releaseOffsetMs", name),
            f"{name} releaseOffsetMs",
        )
        source_path = _relative_path(
            _required(stage, "sourcePath", name),
            f"{name} sourcePath",
        )
        token_count = _integer(
            _required(stage, "tokenCount", name),
            f"{name} tokenCount",
            1,
        )
        sha256 = _string(_required(stage, "sha256", name), f"{name} sha256")
        if _DIGEST.fullmatch(sha256) is None:
            raise ValueError(f"{name} sha256 must be a lowercase SHA-256 digest.")
        regime = _regime(_required(stage, "regime", name), f"{name} regime")
        return cls(
            agent_id=agent_id,
            ordinal=ordinal,
            release_offset_ms=release_offset_ms,
            source_path=source_path,
            token_count=token_count,
            sha256=sha256,
            regime=regime,
        )


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
    def from_dict(cls, value: object) -> PuzzleBuild:
        manifest = _record(value, "Puzzle build manifest")
        schema_version = _integer(
            _required(manifest, "schemaVersion", "Puzzle build manifest"),
            "Puzzle build schemaVersion",
        )
        if schema_version != 1:
            raise ValueError("Unsupported puzzle build schema version.")
        build_id = _string(
            _required(manifest, "buildId", "Puzzle build manifest"),
            "Puzzle build buildId",
        )
        agent_count = _integer(
            _required(manifest, "agentCount", "Puzzle build manifest"),
            "Puzzle build agentCount",
        )
        stage_count = _integer(
            _required(manifest, "stageCount", "Puzzle build manifest"),
            "Puzzle build stageCount",
        )
        if agent_count != len(AGENT_IDS) or stage_count != STAGE_COUNT:
            raise ValueError("Puzzle build must describe exactly three agents and six stages.")
        transition_stage = _integer(
            _required(manifest, "transitionStage", "Puzzle build manifest"),
            "Puzzle build transitionStage",
            2,
        )
        if transition_stage > STAGE_COUNT:
            raise ValueError("Puzzle build transitionStage must be between 2 and 6.")
        stage_interval_ms = _integer(
            _required(manifest, "stageIntervalMs", "Puzzle build manifest"),
            "Puzzle build stageIntervalMs",
            1,
        )

        raw_changed_symbols = _required(manifest, "changedSymbols", "Puzzle build manifest")
        if not isinstance(raw_changed_symbols, list) or not raw_changed_symbols:
            raise ValueError("Puzzle build changedSymbols must be a non-empty array.")
        changed_symbols = tuple(
            _string(symbol, f"Puzzle build changedSymbols[{index}]")
            for index, symbol in enumerate(raw_changed_symbols)
        )
        if (
            len(set(changed_symbols)) != len(changed_symbols)
            or tuple(sorted(changed_symbols)) != changed_symbols
        ):
            raise ValueError("Puzzle build changedSymbols must be unique and sorted.")

        public_ciphertext_path = _relative_path(
            _required(manifest, "publicCiphertextPath", "Puzzle build manifest"),
            "Puzzle build publicCiphertextPath",
        )
        reference_corpus_path = _relative_path(
            _required(manifest, "referenceCorpusPath", "Puzzle build manifest"),
            "Puzzle build referenceCorpusPath",
        )
        oracle_root = _relative_path(
            _required(manifest, "oracleRoot", "Puzzle build manifest"),
            "Puzzle build oracleRoot",
        )

        private_stage_roots = _record(
            _required(manifest, "privateStageRoots", "Puzzle build manifest"),
            "Puzzle build privateStageRoots",
        )
        if set(private_stage_roots) != set(AGENT_IDS):
            raise ValueError("Puzzle build privateStageRoots must contain exactly three agents.")
        for agent_id in AGENT_IDS:
            _relative_path(
                private_stage_roots[agent_id],
                f"Puzzle build {agent_id} private stage root",
            )

        raw_stages = _required(manifest, "stages", "Puzzle build manifest")
        if not isinstance(raw_stages, list) or len(raw_stages) != len(AGENT_IDS) * STAGE_COUNT:
            raise ValueError("Puzzle build must contain exactly three six-stage streams.")
        stages = tuple(
            EvidenceStage.from_dict(raw_stage, name=f"Puzzle build stage {index + 1}")
            for index, raw_stage in enumerate(raw_stages)
        )
        for index, stage in enumerate(stages):
            expected_agent = AGENT_IDS[index // STAGE_COUNT]
            expected_ordinal = index % STAGE_COUNT + 1
            if stage.agent_id != expected_agent or stage.ordinal != expected_ordinal:
                raise ValueError("Puzzle build stages must contain six ordered stages per agent.")

        return cls(
            build_id=build_id,
            stage_interval_ms=stage_interval_ms,
            transition_stage=transition_stage,
            changed_symbols=changed_symbols,
            public_ciphertext_path=public_ciphertext_path,
            reference_corpus_path=reference_corpus_path,
            oracle_root=oracle_root,
            stages=stages,
        )
