from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any

_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_AGENT_ID = re.compile(r"^agent-[1-9][0-9]*$")
_FIXED_AGENT_IDS = ("agent-1", "agent-2", "agent-3")
_FIXED_STAGE_COUNT = 6
_FIXED_BOUNDARY_STAGE = 4
_TIERS = ("strict", "balanced", "fallback")
_TIER_LIMITS = {
    "strict": (0.67, 0.60, 0.04, 0.12, 0.15, 3, 3),
    "balanced": (0.60, 0.67, 0.07, 0.18, 0.25, 2, 2),
    "fallback": (0.55, 0.75, 0.10, 0.25, 0.40, 2, 1),
}


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


def _safe_integer(value: object, name: str) -> int:
    if type(value) is not int or abs(value) > 9_007_199_254_740_991:
        raise ValueError(f"{name} must be an interoperable integer.")
    return value


def _ratio(value: object, name: str, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number between {minimum} and 1.")
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > 1.0:
        raise ValueError(f"{name} must be a finite number between {minimum} and 1.")
    return result


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
    return value


def _identifier(value: object, name: str) -> str:
    result = _string(value, name)
    if _IDENTIFIER.fullmatch(result) is None:
        raise ValueError(f"{name} must be a canonical identifier.")
    return result


def _digest(value: object, name: str) -> str:
    result = _string(value, name)
    if _DIGEST.fullmatch(result) is None:
        raise ValueError(f"{name} must be a lowercase SHA-256 digest.")
    return result


def _prefixed_digest(value: object, prefix: str, name: str) -> str:
    result = _string(value, name)
    if not result.startswith(prefix) or _DIGEST.fullmatch(result[len(prefix) :]) is None:
        raise ValueError(f"{name} must contain a lowercase SHA-256 digest.")
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


def _array(value: object, name: str, *, allow_empty: bool = False) -> list[object]:
    if not isinstance(value, list) or (not allow_empty and not value):
        qualifier = "" if allow_empty else " non-empty"
        raise ValueError(f"{name} must be a{qualifier} array.")
    return value


def _strings(value: object, name: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    items = _array(value, name, allow_empty=allow_empty)
    return tuple(_string(item, f"{name}[{index}]") for index, item in enumerate(items))


def make_agent_ids(agent_count: int) -> tuple[str, ...]:
    if type(agent_count) is not int or agent_count < 2:
        raise ValueError("Puzzle agent count must be an integer of at least two.")
    return tuple(f"agent-{index}" for index in range(1, agent_count + 1))


def stage_filename(ordinal: int, stage_count: int) -> str:
    if type(stage_count) is not int or stage_count < 1:
        raise ValueError("Puzzle stage count must be a positive integer.")
    if type(ordinal) is not int or ordinal < 1 or ordinal > stage_count:
        raise ValueError("Stage ordinal must be within the puzzle stage count.")
    width = max(2, len(str(stage_count)))
    return f"stage-{ordinal:0{width}d}.txt"


@dataclass(frozen=True)
class TargetSource:
    source_id: str
    sha256: str

    def __post_init__(self) -> None:
        _identifier(self.source_id, "Target sourceId")
        _digest(self.sha256, "Target source sha256")

    def to_dict(self) -> dict[str, str]:
        return {"sourceId": self.source_id, "sha256": self.sha256}

    @classmethod
    def from_dict(cls, value: object) -> TargetSource:
        record = _record(
            value,
            "Puzzle build source",
            fields=frozenset({"sourceId", "sha256"}),
        )
        return cls(
            source_id=_identifier(record["sourceId"], "Puzzle build source sourceId"),
            sha256=_digest(record["sha256"], "Puzzle build source sha256"),
        )


@dataclass(frozen=True)
class ReferenceSource:
    source_id: str
    sha256: str

    def __post_init__(self) -> None:
        _identifier(self.source_id, "Reference sourceId")
        _digest(self.sha256, "Reference source sha256")

    def to_dict(self) -> dict[str, str]:
        return {"sourceId": self.source_id, "sha256": self.sha256}

    @classmethod
    def from_dict(cls, value: object, index: int) -> ReferenceSource:
        name = f"Puzzle build reference {index}"
        record = _record(
            value,
            name,
            fields=frozenset({"sourceId", "sha256"}),
        )
        return cls(
            source_id=_identifier(record["sourceId"], f"{name} sourceId"),
            sha256=_digest(record["sha256"], f"{name} sha256"),
        )


@dataclass(frozen=True)
class BuildWindow:
    paragraph_start: int
    paragraph_end: int
    word_count: int
    sha256: str

    def __post_init__(self) -> None:
        if self.paragraph_start < 1 or self.paragraph_end < self.paragraph_start:
            raise ValueError("Build window paragraph range must be positive and ordered.")
        if self.word_count < 16_000 or self.word_count > 20_000:
            raise ValueError("Build window wordCount must be between 16000 and 20000.")
        _digest(self.sha256, "Build window sha256")

    def to_dict(self) -> dict[str, int | str]:
        return {
            "paragraphStart": self.paragraph_start,
            "paragraphEnd": self.paragraph_end,
            "wordCount": self.word_count,
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, value: object) -> BuildWindow:
        record = _record(
            value,
            "Puzzle build window",
            fields=frozenset({"paragraphStart", "paragraphEnd", "wordCount", "sha256"}),
        )
        return cls(
            paragraph_start=_integer(
                record["paragraphStart"], "Puzzle build window paragraphStart", 1
            ),
            paragraph_end=_integer(record["paragraphEnd"], "Puzzle build window paragraphEnd", 1),
            word_count=_integer(record["wordCount"], "Puzzle build window wordCount", 1),
            sha256=_digest(record["sha256"], "Puzzle build window sha256"),
        )


@dataclass(frozen=True)
class TierRejection:
    tier: str
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.tier not in _TIERS:
            raise ValueError("Rejected allocation tier is unsupported.")
        if not self.reasons:
            raise ValueError("Rejected allocation tier reasons must be non-empty.")
        for reason in self.reasons:
            _identifier(reason, "Rejected allocation tier reason")
        if len(set(self.reasons)) != len(self.reasons):
            raise ValueError("Rejected allocation tier reasons must be unique.")

    def to_dict(self) -> dict[str, Any]:
        return {"tier": self.tier, "reasons": list(self.reasons)}

    @classmethod
    def from_dict(cls, value: object, index: int) -> TierRejection:
        name = f"Puzzle build rejected tier {index}"
        record = _record(value, name, fields=frozenset({"tier", "reasons"}))
        return cls(
            tier=_string(record["tier"], f"{name} tier"),
            reasons=_strings(record["reasons"], f"{name} reasons"),
        )


@dataclass(frozen=True)
class AllocationMetrics:
    region_deviation: float
    stage_deviation: float
    solo_changed_set_coverage: float
    min_owner_share: float
    anchor_count: int
    sentinel_count: int
    specialist_counts: dict[str, int]
    min_owner_occurrences_per_region: int
    min_sentinel_occurrences_per_agent_region: int
    unmatched_control_count: int
    max_control_distance: float

    def __post_init__(self) -> None:
        for value, name in (
            (self.region_deviation, "Allocation regionDeviation"),
            (self.stage_deviation, "Allocation stageDeviation"),
            (self.solo_changed_set_coverage, "Allocation soloChangedSetCoverage"),
            (self.min_owner_share, "Allocation minOwnerShare"),
            (self.max_control_distance, "Allocation maxControlDistance"),
        ):
            _ratio(value, name)
        if self.anchor_count < 12:
            raise ValueError("Allocation anchorCount must be at least 12.")
        if self.sentinel_count < 6:
            raise ValueError("Allocation sentinelCount must be at least 6.")
        if set(self.specialist_counts) != set(_FIXED_AGENT_IDS):
            raise ValueError("Allocation specialistCounts must contain exactly three agents.")
        if any(count < 3 for count in self.specialist_counts.values()):
            raise ValueError("Allocation specialistCounts must be at least 3 per agent.")
        if self.min_owner_occurrences_per_region < 1:
            raise ValueError("Allocation owner occurrences must be positive.")
        if self.min_sentinel_occurrences_per_agent_region < 1:
            raise ValueError("Allocation sentinel occurrences must be positive.")
        if self.unmatched_control_count != 0:
            raise ValueError("Allocation unmatchedControlCount must be zero.")

    def to_dict(self) -> dict[str, Any]:
        return {
            "regionDeviation": self.region_deviation,
            "stageDeviation": self.stage_deviation,
            "soloChangedSetCoverage": self.solo_changed_set_coverage,
            "minOwnerShare": self.min_owner_share,
            "anchorCount": self.anchor_count,
            "sentinelCount": self.sentinel_count,
            "specialistCounts": dict(self.specialist_counts),
            "minOwnerOccurrencesPerRegion": self.min_owner_occurrences_per_region,
            "minSentinelOccurrencesPerAgentRegion": (
                self.min_sentinel_occurrences_per_agent_region
            ),
            "unmatchedControlCount": self.unmatched_control_count,
            "maxControlDistance": self.max_control_distance,
        }

    @classmethod
    def from_dict(cls, value: object) -> AllocationMetrics:
        name = "Puzzle build allocation metrics"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "regionDeviation",
                    "stageDeviation",
                    "soloChangedSetCoverage",
                    "minOwnerShare",
                    "anchorCount",
                    "sentinelCount",
                    "specialistCounts",
                    "minOwnerOccurrencesPerRegion",
                    "minSentinelOccurrencesPerAgentRegion",
                    "unmatchedControlCount",
                    "maxControlDistance",
                }
            ),
        )
        counts = _record(record["specialistCounts"], f"{name} specialistCounts")
        if set(counts) != set(_FIXED_AGENT_IDS):
            raise ValueError(f"{name} specialistCounts must contain exactly three agents.")
        return cls(
            region_deviation=_ratio(record["regionDeviation"], f"{name} regionDeviation"),
            stage_deviation=_ratio(record["stageDeviation"], f"{name} stageDeviation"),
            solo_changed_set_coverage=_ratio(
                record["soloChangedSetCoverage"], f"{name} soloChangedSetCoverage"
            ),
            min_owner_share=_ratio(record["minOwnerShare"], f"{name} minOwnerShare"),
            anchor_count=_integer(record["anchorCount"], f"{name} anchorCount"),
            sentinel_count=_integer(record["sentinelCount"], f"{name} sentinelCount"),
            specialist_counts={
                agent_id: _integer(counts[agent_id], f"{name} specialistCounts {agent_id}")
                for agent_id in _FIXED_AGENT_IDS
            },
            min_owner_occurrences_per_region=_integer(
                record["minOwnerOccurrencesPerRegion"],
                f"{name} minOwnerOccurrencesPerRegion",
                1,
            ),
            min_sentinel_occurrences_per_agent_region=_integer(
                record["minSentinelOccurrencesPerAgentRegion"],
                f"{name} minSentinelOccurrencesPerAgentRegion",
                1,
            ),
            unmatched_control_count=_integer(
                record["unmatchedControlCount"], f"{name} unmatchedControlCount"
            ),
            max_control_distance=_ratio(record["maxControlDistance"], f"{name} maxControlDistance"),
        )


@dataclass(frozen=True)
class AllocationSummary:
    allocation_id: str
    tier: str
    metrics: AllocationMetrics
    rejected_tiers: tuple[TierRejection, ...]
    path: Path
    sha256: str

    def __post_init__(self) -> None:
        _prefixed_digest(self.allocation_id, "allocation-", "Allocation ID")
        if self.tier not in _TIERS:
            raise ValueError("Selected allocation tier is unsupported.")
        expected_rejected = _TIERS[: _TIERS.index(self.tier)]
        if tuple(rejection.tier for rejection in self.rejected_tiers) != expected_rejected:
            raise ValueError("Rejected allocation tiers must contain all earlier tiers in order.")
        (
            min_owner,
            max_solo,
            max_region,
            max_stage,
            max_control,
            min_owner_occurrences,
            min_sentinel_occurrences,
        ) = _TIER_LIMITS[self.tier]
        if (
            self.metrics.min_owner_share < min_owner
            or self.metrics.solo_changed_set_coverage > max_solo
            or self.metrics.region_deviation > max_region
            or self.metrics.stage_deviation > max_stage
            or self.metrics.max_control_distance > max_control
            or self.metrics.min_owner_occurrences_per_region < min_owner_occurrences
            or (self.metrics.min_sentinel_occurrences_per_agent_region < min_sentinel_occurrences)
        ):
            raise ValueError(f"Allocation metrics do not satisfy the {self.tier} tier.")
        if self.path.as_posix() != "oracle/allocation.json":
            raise ValueError("Allocation path must be oracle/allocation.json.")
        _digest(self.sha256, "Allocation sha256")

    def to_dict(self) -> dict[str, Any]:
        return {
            "allocationId": self.allocation_id,
            "tier": self.tier,
            "metrics": self.metrics.to_dict(),
            "rejectedTiers": [rejection.to_dict() for rejection in self.rejected_tiers],
            "path": self.path.as_posix(),
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, value: object) -> AllocationSummary:
        name = "Puzzle build allocation"
        record = _record(
            value,
            name,
            fields=frozenset(
                {"allocationId", "tier", "metrics", "rejectedTiers", "path", "sha256"}
            ),
        )
        rejections = _array(record["rejectedTiers"], f"{name} rejectedTiers", allow_empty=True)
        return cls(
            allocation_id=_string(record["allocationId"], f"{name} allocationId"),
            tier=_string(record["tier"], f"{name} tier"),
            metrics=AllocationMetrics.from_dict(record["metrics"]),
            rejected_tiers=tuple(
                TierRejection.from_dict(item, index)
                for index, item in enumerate(rejections, start=1)
            ),
            path=_relative_path(record["path"], f"{name} path"),
            sha256=_digest(record["sha256"], f"{name} sha256"),
        )


@dataclass(frozen=True)
class OracleDesign:
    path: Path
    sha256: str
    anchors_sha256: str
    sentinels_sha256: str
    specialists_sha256: str
    controls_sha256: str

    def __post_init__(self) -> None:
        if self.path.as_posix() != "oracle/design.json":
            raise ValueError("Oracle design path must be oracle/design.json.")
        for value, name in (
            (self.sha256, "Oracle design sha256"),
            (self.anchors_sha256, "Oracle anchors sha256"),
            (self.sentinels_sha256, "Oracle sentinels sha256"),
            (self.specialists_sha256, "Oracle specialists sha256"),
            (self.controls_sha256, "Oracle controls sha256"),
        ):
            _digest(value, name)

    def to_dict(self) -> dict[str, str]:
        return {
            "path": self.path.as_posix(),
            "sha256": self.sha256,
            "anchorsSha256": self.anchors_sha256,
            "sentinelsSha256": self.sentinels_sha256,
            "specialistsSha256": self.specialists_sha256,
            "controlsSha256": self.controls_sha256,
        }

    @classmethod
    def from_dict(cls, value: object) -> OracleDesign:
        name = "Puzzle build oracleDesign"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "path",
                    "sha256",
                    "anchorsSha256",
                    "sentinelsSha256",
                    "specialistsSha256",
                    "controlsSha256",
                }
            ),
        )
        return cls(
            path=_relative_path(record["path"], f"{name} path"),
            sha256=_digest(record["sha256"], f"{name} sha256"),
            anchors_sha256=_digest(record["anchorsSha256"], f"{name} anchorsSha256"),
            sentinels_sha256=_digest(record["sentinelsSha256"], f"{name} sentinelsSha256"),
            specialists_sha256=_digest(record["specialistsSha256"], f"{name} specialistsSha256"),
            controls_sha256=_digest(record["controlsSha256"], f"{name} controlsSha256"),
        )


@dataclass(frozen=True)
class RekeyTransition:
    at_stage: int
    key_version: int
    key_path: Path
    changed_symbols_sha256: str

    def __post_init__(self) -> None:
        if self.at_stage != _FIXED_BOUNDARY_STAGE or self.key_version != 1:
            raise ValueError("Re-key transition must introduce key version 1 at stage 4.")
        if self.key_path.as_posix() != "oracle/keys/rekey-stage-04.json":
            raise ValueError("Re-key transition keyPath must be oracle/keys/rekey-stage-04.json.")
        _digest(self.changed_symbols_sha256, "Re-key changedSymbolsSha256")

    def to_dict(self) -> dict[str, Any]:
        return {
            "atStage": self.at_stage,
            "keyVersion": self.key_version,
            "keyPath": self.key_path.as_posix(),
            "changedSymbolsSha256": self.changed_symbols_sha256,
        }

    @classmethod
    def from_dict(cls, value: object, index: int) -> RekeyTransition:
        name = f"Puzzle build key transition {index}"
        record = _record(
            value,
            name,
            fields=frozenset({"atStage", "keyVersion", "keyPath", "changedSymbolsSha256"}),
        )
        return cls(
            at_stage=_integer(record["atStage"], f"{name} atStage", 1),
            key_version=_integer(record["keyVersion"], f"{name} keyVersion", 1),
            key_path=_relative_path(record["keyPath"], f"{name} keyPath"),
            changed_symbols_sha256=_digest(
                record["changedSymbolsSha256"], f"{name} changedSymbolsSha256"
            ),
        )


@dataclass(frozen=True)
class EvidenceStage:
    agent_id: str
    ordinal: int
    key_version: int
    source_path: Path
    token_count: int
    sha256: str

    def __post_init__(self) -> None:
        if _AGENT_ID.fullmatch(self.agent_id) is None:
            raise ValueError(f"Invalid puzzle agent: {self.agent_id}.")
        if self.ordinal < 1 or self.key_version < 0:
            raise ValueError("Stage ordinal must be positive and key version non-negative.")
        _relative_path(self.source_path.as_posix(), "Stage source path")
        if self.token_count < 1:
            raise ValueError("Every evidence stage must contain at least one word token.")
        _digest(self.sha256, "Stage sha256")

    def to_dict(self) -> dict[str, Any]:
        return {
            "agentId": self.agent_id,
            "ordinal": self.ordinal,
            "keyVersion": self.key_version,
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
                {"agentId", "ordinal", "keyVersion", "sourcePath", "tokenCount", "sha256"}
            ),
        )
        return cls(
            agent_id=_string(record["agentId"], f"{name} agentId"),
            ordinal=_integer(record["ordinal"], f"{name} ordinal", 1),
            key_version=_integer(record["keyVersion"], f"{name} keyVersion"),
            source_path=_relative_path(record["sourcePath"], f"{name} sourcePath"),
            token_count=_integer(record["tokenCount"], f"{name} tokenCount", 1),
            sha256=_digest(record["sha256"], f"{name} sha256"),
        )


@dataclass(frozen=True)
class BuildVariant:
    variant_id: str
    build_id: str
    public_ciphertext_path: Path
    reference_corpus_path: Path
    private_stage_roots: dict[str, Path]
    stages: tuple[EvidenceStage, ...]
    key_transitions: tuple[RekeyTransition, ...]

    def __post_init__(self) -> None:
        if self.variant_id not in {"stationary", "rekey"}:
            raise ValueError("Build variantId must be stationary or rekey.")
        _prefixed_digest(self.build_id, "build-", "Build ID")
        prefix = f"variants/{self.variant_id}"
        if self.public_ciphertext_path.as_posix() != f"{prefix}/complete/ciphertext.txt":
            raise ValueError(
                f"Build {self.variant_id} public ciphertext path must use its variant tree."
            )
        if self.reference_corpus_path.as_posix() != f"{prefix}/references":
            raise ValueError(
                f"Build {self.variant_id} reference corpus path must use its variant tree."
            )
        if set(self.private_stage_roots) != set(_FIXED_AGENT_IDS):
            raise ValueError("Build privateStageRoots must contain exactly three agents.")
        for agent_id in _FIXED_AGENT_IDS:
            expected_root = Path(f"{prefix}/private/{agent_id}/stages")
            if self.private_stage_roots[agent_id] != expected_root:
                raise ValueError(
                    f"Build {self.variant_id} private stage roots must use its variant tree."
                )
        expected_geometry = tuple(
            (agent_id, ordinal)
            for agent_id in _FIXED_AGENT_IDS
            for ordinal in range(1, _FIXED_STAGE_COUNT + 1)
        )
        actual_geometry = tuple((stage.agent_id, stage.ordinal) for stage in self.stages)
        if actual_geometry != expected_geometry:
            raise ValueError("Build variant must contain 18 ordered stages.")
        for stage in self.stages:
            expected_path = Path(
                f"{prefix}/private/{stage.agent_id}/stages/"
                f"{stage_filename(stage.ordinal, _FIXED_STAGE_COUNT)}"
            )
            if stage.source_path != expected_path:
                raise ValueError("Build stage source paths must use the variant private tree.")
            expected_version = (
                1 if self.variant_id == "rekey" and stage.ordinal >= _FIXED_BOUNDARY_STAGE else 0
            )
            if stage.key_version != expected_version:
                raise ValueError("Build variant stage key version is inconsistent.")
        if self.variant_id == "stationary" and self.key_transitions:
            raise ValueError("Stationary variant keyTransitions must be empty.")
        if self.variant_id == "rekey" and len(self.key_transitions) != 1:
            raise ValueError("Rekey variant must contain one stage-four key transition.")

    def to_dict(self) -> dict[str, Any]:
        return {
            "variantId": self.variant_id,
            "buildId": self.build_id,
            "publicCiphertextPath": self.public_ciphertext_path.as_posix(),
            "referenceCorpusPath": self.reference_corpus_path.as_posix(),
            "privateStageRoots": {
                agent_id: self.private_stage_roots[agent_id].as_posix()
                for agent_id in _FIXED_AGENT_IDS
            },
            "stages": [stage.to_dict() for stage in self.stages],
            "keyTransitions": [transition.to_dict() for transition in self.key_transitions],
        }

    @classmethod
    def from_dict(cls, value: object, expected_variant: str) -> BuildVariant:
        name = f"Puzzle build {expected_variant} variant"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "variantId",
                    "buildId",
                    "publicCiphertextPath",
                    "referenceCorpusPath",
                    "privateStageRoots",
                    "stages",
                    "keyTransitions",
                }
            ),
        )
        variant_id = _string(record["variantId"], f"{name} variantId")
        if variant_id != expected_variant:
            raise ValueError(f"{name} variantId must be {expected_variant}.")
        roots = _record(record["privateStageRoots"], f"{name} privateStageRoots")
        if set(roots) != set(_FIXED_AGENT_IDS):
            raise ValueError(f"{name} privateStageRoots must contain exactly three agents.")
        raw_stages = _array(record["stages"], f"{name} stages")
        raw_transitions = _array(
            record["keyTransitions"], f"{name} keyTransitions", allow_empty=True
        )
        return cls(
            variant_id=variant_id,
            build_id=_string(record["buildId"], f"{name} buildId"),
            public_ciphertext_path=_relative_path(
                record["publicCiphertextPath"], f"{name} publicCiphertextPath"
            ),
            reference_corpus_path=_relative_path(
                record["referenceCorpusPath"], f"{name} referenceCorpusPath"
            ),
            private_stage_roots={
                agent_id: _relative_path(roots[agent_id], f"{name} {agent_id} private stage root")
                for agent_id in _FIXED_AGENT_IDS
            },
            stages=tuple(
                EvidenceStage.from_dict(stage, index)
                for index, stage in enumerate(raw_stages, start=1)
            ),
            key_transitions=tuple(
                RekeyTransition.from_dict(transition, index)
                for index, transition in enumerate(raw_transitions, start=1)
            ),
        )


@dataclass(frozen=True)
class ManipulationCheck:
    path: Path
    sha256: str
    pre_boundary_identical: bool
    stationary_old_key_loss: float
    rekey_old_key_loss: float
    changed_token_mass_by_agent: dict[str, float]

    def __post_init__(self) -> None:
        if self.path.as_posix() != "oracle/manipulation-check.json":
            raise ValueError("Manipulation check path must be oracle/manipulation-check.json.")
        _digest(self.sha256, "Manipulation check sha256")
        if self.pre_boundary_identical is not True:
            raise ValueError("Manipulation check must confirm pre-boundary identity.")
        if self.stationary_old_key_loss != 0:
            raise ValueError("Stationary old-key loss must be zero.")
        _ratio(self.rekey_old_key_loss, "Rekey old-key loss", 0.15)
        if set(self.changed_token_mass_by_agent) != set(_FIXED_AGENT_IDS):
            raise ValueError(
                "Manipulation changedTokenMassByAgent must contain exactly three agents."
            )
        for agent_id, mass in self.changed_token_mass_by_agent.items():
            _ratio(mass, f"Manipulation changed token mass for {agent_id}", 0.15)

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path.as_posix(),
            "sha256": self.sha256,
            "preBoundaryIdentical": self.pre_boundary_identical,
            "stationaryOldKeyLoss": self.stationary_old_key_loss,
            "rekeyOldKeyLoss": self.rekey_old_key_loss,
            "changedTokenMassByAgent": {
                agent_id: self.changed_token_mass_by_agent[agent_id]
                for agent_id in _FIXED_AGENT_IDS
            },
        }

    @classmethod
    def from_dict(cls, value: object) -> ManipulationCheck:
        name = "Puzzle build manipulationCheck"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "path",
                    "sha256",
                    "preBoundaryIdentical",
                    "stationaryOldKeyLoss",
                    "rekeyOldKeyLoss",
                    "changedTokenMassByAgent",
                }
            ),
        )
        masses = _record(record["changedTokenMassByAgent"], f"{name} changedTokenMassByAgent")
        if set(masses) != set(_FIXED_AGENT_IDS):
            raise ValueError(f"{name} changedTokenMassByAgent must contain exactly three agents.")
        pre_boundary_identical = record["preBoundaryIdentical"]
        if type(pre_boundary_identical) is not bool:
            raise ValueError(f"{name} preBoundaryIdentical must be a boolean.")
        return cls(
            path=_relative_path(record["path"], f"{name} path"),
            sha256=_digest(record["sha256"], f"{name} sha256"),
            pre_boundary_identical=pre_boundary_identical,
            stationary_old_key_loss=_ratio(
                record["stationaryOldKeyLoss"], f"{name} stationaryOldKeyLoss"
            ),
            rekey_old_key_loss=_ratio(record["rekeyOldKeyLoss"], f"{name} rekeyOldKeyLoss"),
            changed_token_mass_by_agent={
                agent_id: _ratio(
                    masses[agent_id],
                    f"{name} changedTokenMassByAgent {agent_id}",
                )
                for agent_id in _FIXED_AGENT_IDS
            },
        )


@dataclass(frozen=True)
class PuzzleBuild:
    paired_build_id: str
    block_id: str
    source: TargetSource
    references: tuple[ReferenceSource, ...]
    seed: int
    window: BuildWindow
    agent_ids: tuple[str, ...]
    stage_count: int
    boundary_stage: int
    allocation: AllocationSummary
    oracle_design: OracleDesign
    base_key_path: Path
    manipulation_check: ManipulationCheck
    stationary: BuildVariant
    rekey: BuildVariant

    def __post_init__(self) -> None:
        _prefixed_digest(self.paired_build_id, "paired-", "Paired build ID")
        _identifier(self.block_id, "Puzzle blockId")
        _safe_integer(self.seed, "Puzzle seed")
        if self.agent_ids != _FIXED_AGENT_IDS:
            raise ValueError("Puzzle build must contain exactly three canonical agent IDs.")
        if self.stage_count != _FIXED_STAGE_COUNT:
            raise ValueError("Puzzle build stageCount must be exactly 6.")
        if self.boundary_stage != _FIXED_BOUNDARY_STAGE:
            raise ValueError("Puzzle build boundaryStage must be exactly 4.")
        reference_ids = tuple(reference.source_id for reference in self.references)
        if not reference_ids:
            raise ValueError("Puzzle references must be non-empty.")
        if len(set(reference_ids)) != len(reference_ids):
            raise ValueError("Puzzle reference source IDs must be unique.")
        if self.source.source_id in reference_ids:
            raise ValueError("Puzzle target source cannot also be a reference.")
        if self.base_key_path.as_posix() != "oracle/keys/base.json":
            raise ValueError("Puzzle baseKeyPath must be oracle/keys/base.json.")
        if self.stationary.variant_id != "stationary" or self.rekey.variant_id != "rekey":
            raise ValueError("Puzzle variants must contain stationary and rekey records.")
        if self.stationary.build_id == self.rekey.build_id:
            raise ValueError("Puzzle variant build IDs must be distinct.")
        for stationary, rekey in zip(self.stationary.stages, self.rekey.stages, strict=True):
            if stationary.ordinal < self.boundary_stage and stationary.sha256 != rekey.sha256:
                raise ValueError("Puzzle pre-boundary stage digests must be identical.")

    @property
    def agent_count(self) -> int:
        return len(self.agent_ids)

    @property
    def oracle_key_paths(self) -> tuple[Path, ...]:
        return (
            self.base_key_path,
            *(transition.key_path for transition in self.rekey.key_transitions),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 3,
            "pairedBuildId": self.paired_build_id,
            "blockId": self.block_id,
            "source": self.source.to_dict(),
            "references": [reference.to_dict() for reference in self.references],
            "seed": self.seed,
            "window": self.window.to_dict(),
            "agentIds": list(self.agent_ids),
            "stageCount": self.stage_count,
            "boundaryStage": self.boundary_stage,
            "allocation": self.allocation.to_dict(),
            "oracleDesign": self.oracle_design.to_dict(),
            "baseKeyPath": self.base_key_path.as_posix(),
            "manipulationCheck": self.manipulation_check.to_dict(),
            "variants": {
                "stationary": self.stationary.to_dict(),
                "rekey": self.rekey.to_dict(),
            },
        }

    @classmethod
    def from_dict(cls, value: object) -> PuzzleBuild:
        name = "Puzzle build manifest"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "schemaVersion",
                    "pairedBuildId",
                    "blockId",
                    "source",
                    "references",
                    "seed",
                    "window",
                    "agentIds",
                    "stageCount",
                    "boundaryStage",
                    "allocation",
                    "oracleDesign",
                    "baseKeyPath",
                    "manipulationCheck",
                    "variants",
                }
            ),
        )
        if _integer(record["schemaVersion"], f"{name} schemaVersion") != 3:
            raise ValueError("Unsupported puzzle build schema version.")
        agent_ids = _strings(record["agentIds"], f"{name} agentIds")
        raw_references = _array(record["references"], f"{name} references")
        variants = _record(
            record["variants"],
            f"{name} variants",
            fields=frozenset({"stationary", "rekey"}),
        )
        return cls(
            paired_build_id=_string(record["pairedBuildId"], f"{name} pairedBuildId"),
            block_id=_identifier(record["blockId"], f"{name} blockId"),
            source=TargetSource.from_dict(record["source"]),
            references=tuple(
                ReferenceSource.from_dict(reference, index)
                for index, reference in enumerate(raw_references, start=1)
            ),
            seed=_safe_integer(record["seed"], f"{name} seed"),
            window=BuildWindow.from_dict(record["window"]),
            agent_ids=agent_ids,
            stage_count=_integer(record["stageCount"], f"{name} stageCount", 1),
            boundary_stage=_integer(record["boundaryStage"], f"{name} boundaryStage", 1),
            allocation=AllocationSummary.from_dict(record["allocation"]),
            oracle_design=OracleDesign.from_dict(record["oracleDesign"]),
            base_key_path=_relative_path(record["baseKeyPath"], f"{name} baseKeyPath"),
            manipulation_check=ManipulationCheck.from_dict(record["manipulationCheck"]),
            stationary=BuildVariant.from_dict(variants["stationary"], "stationary"),
            rekey=BuildVariant.from_dict(variants["rekey"], "rekey"),
        )
