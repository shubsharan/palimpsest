from __future__ import annotations

import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..serialization import canonical_json_bytes, sha256_hex
from ._decode import (
    _array,
    _digest,
    _identifier,
    _integer,
    _is_identifier,
    _prefixed_digest,
    _ratio,
    _record,
    _relative_path,
    _safe_integer,
    _string,
    _strings,
)


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
class ReferenceFile:
    source_id: str
    source_sha256: str
    path: Path
    byte_length: int
    sha256: str

    def __post_init__(self) -> None:
        _identifier(self.source_id, "Reference file sourceId")
        _digest(self.source_sha256, "Reference file sourceSha256")
        _relative_path(self.path.as_posix(), "Reference file path")
        if self.byte_length < 1:
            raise ValueError("Reference file byteLength must be positive.")
        _digest(self.sha256, "Reference file sha256")

    def to_dict(self) -> dict[str, int | str]:
        return {
            "sourceId": self.source_id,
            "sourceSha256": self.source_sha256,
            "path": self.path.as_posix(),
            "byteLength": self.byte_length,
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, value: object, index: int) -> ReferenceFile:
        name = f"Fixture reference file {index}"
        record = _record(
            value,
            name,
            fields=frozenset({"sourceId", "sourceSha256", "path", "byteLength", "sha256"}),
        )
        return cls(
            source_id=_identifier(record["sourceId"], f"{name} sourceId"),
            source_sha256=_digest(record["sourceSha256"], f"{name} sourceSha256"),
            path=_relative_path(record["path"], f"{name} path"),
            byte_length=_integer(record["byteLength"], f"{name} byteLength", 1),
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
        _identifier(self.tier, "Rejected allocation tier")
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
        if self.anchor_count < 1 or self.sentinel_count < 1:
            raise ValueError("Allocation anchor and sentinel counts must be positive.")
        if not self.specialist_counts or any(
            not _is_identifier(agent_id) for agent_id in self.specialist_counts
        ):
            raise ValueError("Allocation specialistCounts must contain canonical agents.")
        if any(count < 1 for count in self.specialist_counts.values()):
            raise ValueError("Allocation specialistCounts must be positive per agent.")
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
        if not counts:
            raise ValueError(f"{name} specialistCounts must be non-empty.")
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
                for agent_id in sorted(counts)
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
        _identifier(self.tier, "Selected allocation tier")
        rejected_names = tuple(rejection.tier for rejection in self.rejected_tiers)
        if len(set(rejected_names)) != len(rejected_names) or self.tier in rejected_names:
            raise ValueError(
                "Rejected allocation tiers must be unique and exclude the selected tier."
            )
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
        if self.at_stage < 2 or self.key_version != 1:
            raise ValueError("Re-key transition must introduce key version 1 after stage 1.")
        expected_path = f"oracle/keys/rekey-stage-{self.at_stage:02d}.json"
        if self.key_path.as_posix() != expected_path:
            raise ValueError(f"Re-key transition keyPath must be {expected_path}.")
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
        if not _is_identifier(self.agent_id):
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
    rekey_from_stage: int | None
    build_id: str
    public_ciphertext_path: Path
    public_ciphertext_sha256: str
    reference_corpus_path: Path
    reference_files: tuple[ReferenceFile, ...]
    private_stage_roots: dict[str, Path]
    stages: tuple[EvidenceStage, ...]
    key_transitions: tuple[RekeyTransition, ...]

    def __post_init__(self) -> None:
        _identifier(self.variant_id, "Build variantId")
        _prefixed_digest(self.build_id, "build-", "Build ID")
        prefix = f"variants/{self.variant_id}"
        if self.public_ciphertext_path.as_posix() != f"{prefix}/complete/ciphertext.txt":
            raise ValueError(
                f"Build {self.variant_id} public ciphertext path must use its variant tree."
            )
        _digest(self.public_ciphertext_sha256, "Build publicCiphertextSha256")
        if self.reference_corpus_path.as_posix() != f"{prefix}/references":
            raise ValueError(
                f"Build {self.variant_id} reference corpus path must use its variant tree."
            )
        if not self.reference_files:
            raise ValueError("Build referenceFiles must be non-empty.")
        reference_paths = tuple(item.path for item in self.reference_files)
        if len(set(reference_paths)) != len(reference_paths):
            raise ValueError("Build referenceFiles paths must be unique.")
        for reference in self.reference_files:
            if reference.path.parent != self.reference_corpus_path:
                raise ValueError("Build referenceFiles must use the variant reference tree.")
        root_agent_ids = tuple(self.private_stage_roots)
        if len(root_agent_ids) < 2 or any(not _is_identifier(item) for item in root_agent_ids):
            raise ValueError("Build privateStageRoots must contain canonical agents.")
        for agent_id in root_agent_ids:
            expected_root = Path(f"{prefix}/private/{agent_id}/stages")
            if self.private_stage_roots[agent_id] != expected_root:
                raise ValueError(
                    f"Build {self.variant_id} private stage roots must use its variant tree."
                )
        actual_geometry = tuple((stage.agent_id, stage.ordinal) for stage in self.stages)
        if not actual_geometry:
            raise ValueError("Build variant must contain ordered stages.")
        stage_agent_ids = tuple(dict.fromkeys(stage.agent_id for stage in self.stages))
        if set(stage_agent_ids) != set(root_agent_ids):
            raise ValueError("Build variant stages must match its private stage roots.")
        stage_count = max(stage.ordinal for stage in self.stages)
        expected_geometry = tuple(
            (agent_id, ordinal)
            for agent_id in stage_agent_ids
            for ordinal in range(1, stage_count + 1)
        )
        if actual_geometry != expected_geometry:
            raise ValueError("Build variant must contain complete ordered stage geometry.")
        for stage in self.stages:
            expected_path = Path(
                f"{prefix}/private/{stage.agent_id}/stages/"
                f"{stage_filename(stage.ordinal, stage_count)}"
            )
            if stage.source_path != expected_path:
                raise ValueError("Build stage source paths must use the variant private tree.")
            expected_version = int(
                self.rekey_from_stage is not None and stage.ordinal >= self.rekey_from_stage
            )
            if stage.key_version != expected_version:
                raise ValueError("Build variant stage key version is inconsistent.")
        if self.rekey_from_stage is None and self.key_transitions:
            raise ValueError("Stationary variant keyTransitions must be empty.")
        if self.rekey_from_stage is not None and (
            len(self.key_transitions) != 1
            or self.key_transitions[0].at_stage != self.rekey_from_stage
        ):
            raise ValueError("Re-key variant must contain its declared key transition.")

    def to_dict(self) -> dict[str, Any]:
        return {
            "variantId": self.variant_id,
            "rekeyFromStage": self.rekey_from_stage,
            "buildId": self.build_id,
            "publicCiphertextPath": self.public_ciphertext_path.as_posix(),
            "publicCiphertextSha256": self.public_ciphertext_sha256,
            "referenceCorpusPath": self.reference_corpus_path.as_posix(),
            "referenceFiles": [item.to_dict() for item in self.reference_files],
            "privateStageRoots": {
                agent_id: self.private_stage_roots[agent_id].as_posix()
                for agent_id in self.private_stage_roots
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
                    "rekeyFromStage",
                    "buildId",
                    "publicCiphertextPath",
                    "publicCiphertextSha256",
                    "referenceCorpusPath",
                    "referenceFiles",
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
        if len(roots) < 2:
            raise ValueError(f"{name} privateStageRoots must contain at least two agents.")
        raw_stages = _array(record["stages"], f"{name} stages")
        raw_reference_files = _array(record["referenceFiles"], f"{name} referenceFiles")
        raw_transitions = _array(
            record["keyTransitions"], f"{name} keyTransitions", allow_empty=True
        )
        return cls(
            variant_id=variant_id,
            rekey_from_stage=(
                None
                if record["rekeyFromStage"] is None
                else _integer(record["rekeyFromStage"], f"{name} rekeyFromStage", 2)
            ),
            build_id=_string(record["buildId"], f"{name} buildId"),
            public_ciphertext_path=_relative_path(
                record["publicCiphertextPath"], f"{name} publicCiphertextPath"
            ),
            public_ciphertext_sha256=_digest(
                record["publicCiphertextSha256"], f"{name} publicCiphertextSha256"
            ),
            reference_corpus_path=_relative_path(
                record["referenceCorpusPath"], f"{name} referenceCorpusPath"
            ),
            reference_files=tuple(
                ReferenceFile.from_dict(item, index)
                for index, item in enumerate(raw_reference_files, start=1)
            ),
            private_stage_roots={
                agent_id: _relative_path(roots[agent_id], f"{name} {agent_id} private stage root")
                for agent_id in roots
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
        _ratio(self.rekey_old_key_loss, "Rekey old-key loss")
        if len(self.changed_token_mass_by_agent) < 2:
            raise ValueError("Manipulation changedTokenMassByAgent must contain agents.")
        for agent_id, mass in self.changed_token_mass_by_agent.items():
            _ratio(mass, f"Manipulation changed token mass for {agent_id}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path.as_posix(),
            "sha256": self.sha256,
            "preBoundaryIdentical": self.pre_boundary_identical,
            "stationaryOldKeyLoss": self.stationary_old_key_loss,
            "rekeyOldKeyLoss": self.rekey_old_key_loss,
            "changedTokenMassByAgent": {
                agent_id: self.changed_token_mass_by_agent[agent_id]
                for agent_id in self.changed_token_mass_by_agent
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
        if len(masses) < 2:
            raise ValueError(f"{name} changedTokenMassByAgent must contain agents.")
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
                for agent_id in masses
            },
        )


@dataclass(frozen=True)
class FixturePackage:
    fixture_id: str
    content_digest: str
    source: TargetSource
    references: tuple[ReferenceSource, ...]
    seed: int
    window: BuildWindow
    agent_ids: tuple[str, ...]
    stage_count: int
    allocation: AllocationSummary
    oracle_design: OracleDesign
    base_key_path: Path
    manipulation_check: ManipulationCheck
    variants: dict[str, BuildVariant]

    def __post_init__(self) -> None:
        _identifier(self.fixture_id, "Fixture package fixtureId")
        _digest(self.content_digest, "Fixture package contentDigest")
        _safe_integer(self.seed, "Fixture seed")
        if len(self.agent_ids) < 2 or len(set(self.agent_ids)) != len(self.agent_ids):
            raise ValueError("Fixture package must contain at least two unique agents.")
        if any(not _is_identifier(agent_id) for agent_id in self.agent_ids):
            raise ValueError("Fixture package agent IDs must be canonical identifiers.")
        if self.stage_count < 2:
            raise ValueError("Fixture package stageCount must be at least 2.")
        reference_ids = tuple(reference.source_id for reference in self.references)
        if not reference_ids:
            raise ValueError("Puzzle references must be non-empty.")
        if len(set(reference_ids)) != len(reference_ids):
            raise ValueError("Puzzle reference source IDs must be unique.")
        if self.source.source_id in reference_ids:
            raise ValueError("Puzzle target source cannot also be a reference.")
        reference_digests = {reference.source_id: reference.sha256 for reference in self.references}
        if self.base_key_path.as_posix() != "oracle/keys/base.json":
            raise ValueError("Puzzle baseKeyPath must be oracle/keys/base.json.")
        if not self.variants or set(self.variants) != {
            variant.variant_id for variant in self.variants.values()
        }:
            raise ValueError("Fixture variants must be keyed by unique variantId.")
        if sum(variant.rekey_from_stage is None for variant in self.variants.values()) != 1:
            raise ValueError("Fixture package must contain one stationary variant.")
        expected_geometry = tuple(
            (agent_id, ordinal)
            for agent_id in self.agent_ids
            for ordinal in range(1, self.stage_count + 1)
        )
        stationary = next(
            variant for variant in self.variants.values() if variant.rekey_from_stage is None
        )
        if set(self.allocation.metrics.specialist_counts) != set(self.agent_ids):
            raise ValueError("Allocation specialistCounts must match fixture agents.")
        if set(self.manipulation_check.changed_token_mass_by_agent) != set(self.agent_ids):
            raise ValueError("Manipulation masses must match fixture agents.")
        for variant in self.variants.values():
            if (
                tuple((stage.agent_id, stage.ordinal) for stage in variant.stages)
                != expected_geometry
            ):
                raise ValueError("Fixture variants must match declared stage geometry.")
            file_digests = {
                reference.source_id: reference.source_sha256
                for reference in variant.reference_files
            }
            if (
                len(file_digests) != len(variant.reference_files)
                or file_digests != reference_digests
            ):
                raise ValueError(
                    "Fixture variant referenceFiles must match declared reference sources."
                )
            if variant.rekey_from_stage is not None:
                for baseline_stage, rekey_stage in zip(
                    stationary.stages, variant.stages, strict=True
                ):
                    if (
                        baseline_stage.ordinal < variant.rekey_from_stage
                        and baseline_stage.sha256 != rekey_stage.sha256
                    ):
                        raise ValueError("Fixture variants diverge before their re-key boundary.")

    @property
    def agent_count(self) -> int:
        return len(self.agent_ids)

    @property
    def oracle_key_paths(self) -> tuple[Path, ...]:
        return (
            self.base_key_path,
            *(
                transition.key_path
                for variant in self.variants.values()
                for transition in variant.key_transitions
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": 1,
            "fixtureId": self.fixture_id,
            "contentDigest": self.content_digest,
            "source": self.source.to_dict(),
            "references": [reference.to_dict() for reference in self.references],
            "seed": self.seed,
            "window": self.window.to_dict(),
            "agentIds": list(self.agent_ids),
            "stageCount": self.stage_count,
            "allocation": self.allocation.to_dict(),
            "oracleDesign": self.oracle_design.to_dict(),
            "baseKeyPath": self.base_key_path.as_posix(),
            "manipulationCheck": self.manipulation_check.to_dict(),
            "variants": {key: value.to_dict() for key, value in self.variants.items()},
        }

    def computed_content_digest(self, package_root: Path | None = None) -> str:
        record = self.to_dict()
        del record["contentDigest"]
        files = []
        if package_root is not None:
            for path in package_root.rglob("*"):
                relative = path.relative_to(package_root).as_posix()
                if relative == "fixture.json" or not stat.S_ISREG(path.lstat().st_mode):
                    continue
                files.append({"path": relative, "sha256": sha256_hex(path.read_bytes())})
        files.sort(key=lambda item: item["path"])
        return sha256_hex(canonical_json_bytes({"manifest": record, "files": files}))

    @classmethod
    def from_dict(cls, value: object, package_root: Path | None = None) -> FixturePackage:
        name = "Fixture package"
        record = _record(
            value,
            name,
            fields=frozenset(
                {
                    "schemaVersion",
                    "fixtureId",
                    "contentDigest",
                    "source",
                    "references",
                    "seed",
                    "window",
                    "agentIds",
                    "stageCount",
                    "allocation",
                    "oracleDesign",
                    "baseKeyPath",
                    "manipulationCheck",
                    "variants",
                }
            ),
        )
        if _integer(record["schemaVersion"], f"{name} schemaVersion") != 1:
            raise ValueError("Unsupported fixture package schema version.")
        agent_ids = _strings(record["agentIds"], f"{name} agentIds")
        raw_references = _array(record["references"], f"{name} references")
        variants = _record(record["variants"], f"{name} variants")
        if not variants:
            raise ValueError(f"{name} variants must be non-empty.")
        package = cls(
            fixture_id=_identifier(record["fixtureId"], f"{name} fixtureId"),
            content_digest=_digest(record["contentDigest"], f"{name} contentDigest"),
            source=TargetSource.from_dict(record["source"]),
            references=tuple(
                ReferenceSource.from_dict(reference, index)
                for index, reference in enumerate(raw_references, start=1)
            ),
            seed=_safe_integer(record["seed"], f"{name} seed"),
            window=BuildWindow.from_dict(record["window"]),
            agent_ids=agent_ids,
            stage_count=_integer(record["stageCount"], f"{name} stageCount", 1),
            allocation=AllocationSummary.from_dict(record["allocation"]),
            oracle_design=OracleDesign.from_dict(record["oracleDesign"]),
            base_key_path=_relative_path(record["baseKeyPath"], f"{name} baseKeyPath"),
            manipulation_check=ManipulationCheck.from_dict(record["manipulationCheck"]),
            variants={key: BuildVariant.from_dict(item, key) for key, item in variants.items()},
        )
        if package_root is not None and package.content_digest != package.computed_content_digest(
            package_root
        ):
            raise ValueError("Fixture package contentDigest does not match its content.")
        return package
