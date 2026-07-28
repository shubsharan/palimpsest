from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_SOURCE_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_AGENT_ID = re.compile(r"^agent-[1-9][0-9]*$")


def _record(
    value: object,
    name: str,
    *,
    fields: frozenset[str] | None = None,
) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object.")
    record = {key: item for key, item in value.items() if isinstance(key, str)}
    if fields is not None:
        missing = fields - record.keys()
        extra = record.keys() - fields
        if missing:
            raise ValueError(f"{name} {sorted(missing)[0]} is required.")
        if extra:
            raise ValueError(f"{name} contains unknown field {sorted(extra)[0]}.")
    return record


def _integer(value: object, name: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or abs(value) > 9_007_199_254_740_991:
        raise ValueError(f"{name} must be an integer of at least {minimum}.")
    return value


def _number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number strictly between zero and one.")
    result = float(value)
    if not math.isfinite(result) or not 0.0 < result < 1.0:
        raise ValueError(f"{name} must be a finite number strictly between zero and one.")
    return result


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
    return value


def _digest(value: object, name: str) -> str:
    result = _string(value, name)
    if _DIGEST.fullmatch(result) is None:
        raise ValueError(f"{name} must be a lowercase SHA-256 digest.")
    return result


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


def _strings(value: object, name: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list) or (not allow_empty and not value):
        qualifier = "" if allow_empty else " non-empty"
        raise ValueError(f"{name} must be a{qualifier} array.")
    return tuple(_string(item, f"{name}[{index}]") for index, item in enumerate(value))


def make_agent_ids(agent_count: int) -> tuple[str, ...]:
    if type(agent_count) is not int or agent_count < 2:
        raise ValueError("Puzzle agent count must be an integer of at least two.")
    return tuple(f"agent-{index}" for index in range(1, agent_count + 1))


@dataclass(frozen=True)
class TargetSource:
    source_id: str
    sha256: str
    chapter_start: int
    chapter_end: int

    def __post_init__(self) -> None:
        if _SOURCE_ID.fullmatch(self.source_id) is None:
            raise ValueError("Target sourceId must be a canonical identifier.")
        _digest(self.sha256, "Target source sha256")
        if self.chapter_start < 1 or self.chapter_end < self.chapter_start:
            raise ValueError("Target chapter range must be one-based and ordered.")

    def to_dict(self) -> dict[str, Any]:
        return {
            "sourceId": self.source_id,
            "sha256": self.sha256,
            "chapters": {"start": self.chapter_start, "end": self.chapter_end},
        }

    @classmethod
    def from_dict(cls, value: object) -> TargetSource:
        record = _record(
            value,
            "Puzzle build source",
            fields=frozenset({"sourceId", "sha256", "chapters"}),
        )
        chapters = _record(
            record["chapters"],
            "Puzzle build source chapters",
            fields=frozenset({"start", "end"}),
        )
        return cls(
            source_id=_string(record["sourceId"], "Puzzle build source sourceId"),
            sha256=_digest(record["sha256"], "Puzzle build source sha256"),
            chapter_start=_integer(chapters["start"], "Puzzle build source chapter start", 1),
            chapter_end=_integer(chapters["end"], "Puzzle build source chapter end", 1),
        )


@dataclass(frozen=True)
class ReferenceSource:
    source_id: str
    sha256: str
    path: Path

    def __post_init__(self) -> None:
        if _SOURCE_ID.fullmatch(self.source_id) is None:
            raise ValueError("Reference sourceId must be a canonical identifier.")
        _digest(self.sha256, "Reference source sha256")
        _relative_path(self.path.as_posix(), "Reference source path")

    def to_dict(self) -> dict[str, str]:
        return {
            "sourceId": self.source_id,
            "sha256": self.sha256,
            "path": self.path.as_posix(),
        }

    @classmethod
    def from_dict(cls, value: object, index: int) -> ReferenceSource:
        record = _record(
            value,
            f"Puzzle build reference {index}",
            fields=frozenset({"sourceId", "sha256", "path"}),
        )
        return cls(
            source_id=_string(record["sourceId"], f"Puzzle build reference {index} sourceId"),
            sha256=_digest(record["sha256"], f"Puzzle build reference {index} sha256"),
            path=_relative_path(record["path"], f"Puzzle build reference {index} path"),
        )


@dataclass(frozen=True)
class RekeyTransition:
    at_stage: int
    key_version: int
    changed_token_mass: float
    changed_symbols: tuple[str, ...]
    key_path: Path

    def __post_init__(self) -> None:
        if self.at_stage < 2 or self.key_version < 1:
            raise ValueError("Re-key stage and key version must be positive transition values.")
        _number(self.changed_token_mass, "Re-key changedTokenMass")
        if (
            len(self.changed_symbols) < 2
            or len(set(self.changed_symbols)) != len(self.changed_symbols)
            or tuple(sorted(self.changed_symbols)) != self.changed_symbols
        ):
            raise ValueError(
                "Re-key changedSymbols must contain at least two unique sorted values."
            )
        _relative_path(self.key_path.as_posix(), "Re-key keyPath")

    def to_dict(self) -> dict[str, Any]:
        return {
            "atStage": self.at_stage,
            "keyVersion": self.key_version,
            "changedTokenMass": self.changed_token_mass,
            "changedSymbols": list(self.changed_symbols),
            "keyPath": self.key_path.as_posix(),
        }

    @classmethod
    def from_dict(cls, value: object, index: int) -> RekeyTransition:
        name = f"Puzzle build rekey {index}"
        record = _record(
            value,
            name,
            fields=frozenset(
                {"atStage", "keyVersion", "changedTokenMass", "changedSymbols", "keyPath"}
            ),
        )
        changed_symbols = _strings(record["changedSymbols"], f"{name} changedSymbols")
        return cls(
            at_stage=_integer(record["atStage"], f"{name} atStage", 2),
            key_version=_integer(record["keyVersion"], f"{name} keyVersion", 1),
            changed_token_mass=_number(record["changedTokenMass"], f"{name} changedTokenMass"),
            changed_symbols=changed_symbols,
            key_path=_relative_path(record["keyPath"], f"{name} keyPath"),
        )


@dataclass(frozen=True)
class EvidenceStage:
    agent_id: str
    ordinal: int
    key_version: int
    release_offset_ms: int
    source_path: Path
    token_count: int
    sha256: str

    def __post_init__(self) -> None:
        if _AGENT_ID.fullmatch(self.agent_id) is None:
            raise ValueError(f"Invalid puzzle agent: {self.agent_id}.")
        if self.ordinal < 1 or self.key_version < 0 or self.release_offset_ms < 0:
            raise ValueError("Stage ordinal, key version, and release offset must be non-negative.")
        _relative_path(self.source_path.as_posix(), "Stage source path")
        if self.token_count < 1:
            raise ValueError("Every evidence stage must contain at least one word token.")
        _digest(self.sha256, "Stage sha256")

    def to_dict(self) -> dict[str, Any]:
        return {
            "agentId": self.agent_id,
            "ordinal": self.ordinal,
            "keyVersion": self.key_version,
            "releaseOffsetMs": self.release_offset_ms,
            "sourcePath": self.source_path.as_posix(),
            "tokenCount": self.token_count,
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, value: object, index: int) -> EvidenceStage:
        name = f"Puzzle build stage {index}"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "agentId",
                    "ordinal",
                    "keyVersion",
                    "releaseOffsetMs",
                    "sourcePath",
                    "tokenCount",
                    "sha256",
                }
            ),
        )
        return cls(
            agent_id=_string(record["agentId"], f"{name} agentId"),
            ordinal=_integer(record["ordinal"], f"{name} ordinal", 1),
            key_version=_integer(record["keyVersion"], f"{name} keyVersion"),
            release_offset_ms=_integer(record["releaseOffsetMs"], f"{name} releaseOffsetMs"),
            source_path=_relative_path(record["sourcePath"], f"{name} sourcePath"),
            token_count=_integer(record["tokenCount"], f"{name} tokenCount", 1),
            sha256=_digest(record["sha256"], f"{name} sha256"),
        )


@dataclass(frozen=True)
class PuzzleBuild:
    build_id: str
    seed: int
    source: TargetSource
    references: tuple[ReferenceSource, ...]
    agent_ids: tuple[str, ...]
    stage_count: int
    stage_interval_ms: int
    rekeys: tuple[RekeyTransition, ...]
    public_ciphertext_path: Path
    reference_corpus_path: Path
    private_stage_roots: dict[str, Path]
    oracle_root: Path
    base_key_path: Path
    stages: tuple[EvidenceStage, ...]

    def __post_init__(self) -> None:
        if not self.build_id.startswith("build-") or _DIGEST.fullmatch(self.build_id[6:]) is None:
            raise ValueError("Build ID must contain a lowercase SHA-256 digest.")
        if type(self.seed) is not int or abs(self.seed) > 9_007_199_254_740_991:
            raise ValueError("Puzzle seed must be an interoperable integer.")
        if self.agent_ids != make_agent_ids(len(self.agent_ids)):
            raise ValueError("Puzzle agentIds must use canonical numeric order.")
        if self.stage_count < 1 or self.stage_interval_ms < 1:
            raise ValueError("Puzzle stage count and interval must be positive.")
        reference_ids = tuple(reference.source_id for reference in self.references)
        if len(set(reference_ids)) != len(reference_ids) or self.source.source_id in reference_ids:
            raise ValueError("Puzzle references must be unique and exclude the target source.")
        stages = tuple(transition.at_stage for transition in self.rekeys)
        if stages != tuple(sorted(set(stages))) or any(
            stage > self.stage_count for stage in stages
        ):
            raise ValueError(
                "Puzzle re-key stages must be strictly ascending within stage geometry."
            )
        if tuple(transition.key_version for transition in self.rekeys) != tuple(
            range(1, len(self.rekeys) + 1)
        ):
            raise ValueError("Puzzle re-key key versions must be consecutive and one-based.")
        _relative_path(self.base_key_path.as_posix(), "Puzzle baseKeyPath")
        key_paths = self.oracle_key_paths
        if len(set(key_paths)) != len(key_paths):
            raise ValueError("Puzzle key paths must be unique.")
        for path, name in (
            (self.public_ciphertext_path, "Public ciphertext path"),
            (self.reference_corpus_path, "Reference corpus path"),
            (self.oracle_root, "Oracle root"),
        ):
            _relative_path(path.as_posix(), name)
        if set(self.private_stage_roots) != set(self.agent_ids):
            raise ValueError("Puzzle privateStageRoots must contain the canonical agent IDs.")
        for agent_id, path in self.private_stage_roots.items():
            _relative_path(path.as_posix(), f"Puzzle {agent_id} private stage root")

        expected = tuple(
            (agent_id, ordinal)
            for agent_id in self.agent_ids
            for ordinal in range(1, self.stage_count + 1)
        )
        actual = tuple((stage.agent_id, stage.ordinal) for stage in self.stages)
        if actual != expected:
            raise ValueError("Puzzle build stages must contain ordered stages for every agent.")
        for stage in self.stages:
            expected_offset = (stage.ordinal - 1) * self.stage_interval_ms
            expected_version = sum(
                transition.at_stage <= stage.ordinal for transition in self.rekeys
            )
            if stage.release_offset_ms != expected_offset:
                raise ValueError("Stage release offsets must follow the configured interval.")
            if stage.key_version != expected_version:
                raise ValueError("Stage key version does not match the re-key schedule.")

    @property
    def agent_count(self) -> int:
        return len(self.agent_ids)

    @property
    def oracle_key_paths(self) -> tuple[Path, ...]:
        return (self.base_key_path, *(transition.key_path for transition in self.rekeys))

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 2,
            "buildId": self.build_id,
            "seed": self.seed,
            "source": self.source.to_dict(),
            "references": [reference.to_dict() for reference in self.references],
            "agentIds": list(self.agent_ids),
            "stageCount": self.stage_count,
            "stageIntervalMs": self.stage_interval_ms,
            "rekeys": [transition.to_dict() for transition in self.rekeys],
            "publicCiphertextPath": self.public_ciphertext_path.as_posix(),
            "referenceCorpusPath": self.reference_corpus_path.as_posix(),
            "privateStageRoots": {
                agent_id: path.as_posix() for agent_id, path in self.private_stage_roots.items()
            },
            "oracleRoot": self.oracle_root.as_posix(),
            "baseKeyPath": self.base_key_path.as_posix(),
            "stages": [stage.to_dict() for stage in self.stages],
        }

    @classmethod
    def from_dict(cls, value: object) -> PuzzleBuild:
        record = _record(
            value,
            "Puzzle build manifest",
            fields=frozenset(
                {
                    "schemaVersion",
                    "buildId",
                    "seed",
                    "source",
                    "references",
                    "agentIds",
                    "stageCount",
                    "stageIntervalMs",
                    "rekeys",
                    "publicCiphertextPath",
                    "referenceCorpusPath",
                    "privateStageRoots",
                    "oracleRoot",
                    "baseKeyPath",
                    "stages",
                }
            ),
        )
        if _integer(record["schemaVersion"], "Puzzle build schemaVersion") != 2:
            raise ValueError("Unsupported puzzle build schema version.")
        raw_references = record["references"]
        raw_rekeys = record["rekeys"]
        raw_stages = record["stages"]
        if not isinstance(raw_references, list):
            raise ValueError("Puzzle build references must be an array.")
        if not isinstance(raw_rekeys, list):
            raise ValueError("Puzzle build rekeys must be an array.")
        if not isinstance(raw_stages, list):
            raise ValueError("Puzzle build stages must be an array.")
        agent_ids = _strings(record["agentIds"], "Puzzle build agentIds")
        if agent_ids != make_agent_ids(len(agent_ids)):
            raise ValueError("Puzzle build agentIds must use canonical numeric order.")
        private_roots = _record(record["privateStageRoots"], "Puzzle build privateStageRoots")
        if set(private_roots) != set(agent_ids):
            raise ValueError(
                "Puzzle build privateStageRoots must contain exactly the canonical agent IDs."
            )
        return cls(
            build_id=_string(record["buildId"], "Puzzle build buildId"),
            seed=_integer(record["seed"], "Puzzle build seed", -9_007_199_254_740_991),
            source=TargetSource.from_dict(record["source"]),
            references=tuple(
                ReferenceSource.from_dict(reference, index)
                for index, reference in enumerate(raw_references, start=1)
            ),
            agent_ids=agent_ids,
            stage_count=_integer(record["stageCount"], "Puzzle build stageCount", 1),
            stage_interval_ms=_integer(
                record["stageIntervalMs"], "Puzzle build stageIntervalMs", 1
            ),
            rekeys=tuple(
                RekeyTransition.from_dict(rekey, index)
                for index, rekey in enumerate(raw_rekeys, start=1)
            ),
            public_ciphertext_path=_relative_path(
                record["publicCiphertextPath"], "Puzzle build publicCiphertextPath"
            ),
            reference_corpus_path=_relative_path(
                record["referenceCorpusPath"], "Puzzle build referenceCorpusPath"
            ),
            private_stage_roots={
                agent_id: _relative_path(
                    private_roots.get(agent_id),
                    f"Puzzle build {agent_id} private stage root",
                )
                for agent_id in agent_ids
            },
            oracle_root=_relative_path(record["oracleRoot"], "Puzzle build oracleRoot"),
            base_key_path=_relative_path(record["baseKeyPath"], "Puzzle build baseKeyPath"),
            stages=tuple(
                EvidenceStage.from_dict(stage, index)
                for index, stage in enumerate(raw_stages, start=1)
            ),
        )
