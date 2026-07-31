from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..serialization import canonical_json_bytes, sha256_hex
from .block import (
    AGENT_IDS,
    BOUNDARY_STAGE,
    STAGE_COUNT,
    AllocationResult,
    BlockDefinition,
    BlockDesign,
    ParagraphAssignment,
    ParagraphUnit,
    WindowPin,
    design_block,
)
from .block import (
    OracleDesign as BlockOracleDesign,
)
from .cipher import apply_mapping, stationary_key
from .corpus import (
    SourceDefinition,
    build_reference_corpus,
    load_paragraphs,
    load_source_registry,
    load_text_source,
    serialize_paragraphs,
)
from .manifest import (
    AllocationMetrics,
    AllocationSummary,
    BuildVariant,
    BuildWindow,
    EvidenceStage,
    ManipulationCheck,
    PuzzleBuild,
    ReferenceSource,
    RekeyTransition,
    TargetSource,
    TierRejection,
    stage_filename,
)
from .manifest import (
    OracleDesign as ManifestOracleDesign,
)
from .revision import revise_explicit_types
from .text import word_tokens

MINIMUM_MANIPULATION_MASS = 0.15
REFERENCE_SOURCE_IDS = ("middlemarch", "moby-dick", "jane-eyre")


def _seed_hex(seed: int, domain: str) -> str:
    return hashlib.sha256(f"palimpsest-block:{seed}:{domain}".encode("ascii")).hexdigest()


def _words(value: str) -> list[str]:
    return [token.normalized for token in word_tokens(value) if token.normalized is not None]


def _write(path: Path, content: bytes) -> dict[str, int | str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {"byteLength": len(content), "sha256": sha256_hex(content)}


def _assert_available_output(output: Path) -> None:
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise FileExistsError(f"Puzzle build output is non-empty: {output}")


def _publish_staging(staging: Path, output: Path) -> None:
    if output.exists():
        output.rmdir()
    os.replace(staging, output)


def _paragraph_units(source: SourceDefinition) -> tuple[ParagraphUnit, ...]:
    return tuple(
        ParagraphUnit.from_text(ordinal, paragraph)
        for ordinal, paragraph in enumerate(load_paragraphs(source), start=1)
    )


def _allocation_record(design: BlockDesign) -> dict[str, Any]:
    result = design.allocation
    metrics = result.design.metrics
    return {
        "schemaVersion": 1,
        "allocationId": result.allocation.allocation_id,
        "tier": result.tier.name,
        "metrics": {
            "regionDeviation": metrics.region_deviation,
            "stageDeviation": metrics.stage_deviation,
            "soloChangedSetCoverageByAgent": dict(metrics.solo_coverage),
            "postChangedMassByAgent": dict(metrics.post_changed_mass),
            "globalOldKeyLoss": metrics.global_old_key_loss,
            "maximumControlDistance": metrics.maximum_control_distance,
            "minOwnerOccurrencesPerRegion": metrics.min_owner_occurrences_per_region,
            "minSentinelOccurrencesPerAgentRegion": (
                metrics.min_sentinel_occurrences_per_agent_region
            ),
        },
        "rejectedTiers": [
            {"tier": rejection.tier, "reasons": list(rejection.reasons)}
            for rejection in result.rejected_tiers
        ],
        "assignments": [
            {
                "paragraphOrdinal": assignment.paragraph.ordinal,
                "agentId": assignment.agent_id,
                "stage": assignment.stage,
            }
            for assignment in result.allocation.assignments
        ],
    }


def _control_record(design: BlockOracleDesign) -> list[dict[str, Any]]:
    return [
        {
            "changedType": match.changed_type,
            "controlType": match.control_type,
            "frequencyDistance": match.frequency_distance,
            "exposureDistance": match.exposure_distance,
            "contextDistance": match.context_distance,
            "distance": match.distance,
        }
        for match in design.controls
    ]


def _oracle_record(design: BlockOracleDesign) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "anchors": list(design.anchors),
        "sentinels": list(design.sentinels),
        "specialists": {agent_id: list(design.specialists[agent_id]) for agent_id in AGENT_IDS},
        "controls": _control_record(design),
        "changedTypes": list(design.changed_types),
    }


def _owner_share(design: BlockOracleDesign) -> float:
    shares: list[float] = []
    for agent_index, agent_id in enumerate(AGENT_IDS):
        for word in design.specialists[agent_id]:
            exposure = design.profiles[word].exposures
            pre_total = exposure[0] + exposure[2] + exposure[4]
            post_total = exposure[1] + exposure[3] + exposure[5]
            shares.append(
                min(
                    exposure[agent_index * 2] / pre_total,
                    exposure[agent_index * 2 + 1] / post_total,
                )
            )
    if not shares:
        raise ValueError("Oracle design has no specialist ownership evidence.")
    return min(shares)


def _manifest_metrics(result: AllocationResult) -> AllocationMetrics:
    design = result.design
    metrics = design.metrics
    return AllocationMetrics(
        region_deviation=metrics.region_deviation,
        stage_deviation=metrics.stage_deviation,
        solo_changed_set_coverage=max(metrics.solo_coverage.values()),
        min_owner_share=_owner_share(design),
        anchor_count=len(design.anchors),
        sentinel_count=len(design.sentinels),
        specialist_counts={agent_id: len(design.specialists[agent_id]) for agent_id in AGENT_IDS},
        min_owner_occurrences_per_region=metrics.min_owner_occurrences_per_region,
        min_sentinel_occurrences_per_agent_region=(
            metrics.min_sentinel_occurrences_per_agent_region
        ),
        unmatched_control_count=len(design.changed_types) - len(design.controls),
        max_control_distance=metrics.maximum_control_distance,
    )


def _stage_plaintext(assignment: tuple[ParagraphAssignment, ...]) -> str:
    return serialize_paragraphs(
        tuple(
            item.paragraph.text
            for item in sorted(assignment, key=lambda item: item.paragraph.ordinal)
        )
    )


def _variant_stage_bytes(
    assignments: tuple[ParagraphAssignment, ...],
    *,
    base_key: dict[str, str],
    revised_key: dict[str, str],
    variant_id: str,
) -> tuple[dict[tuple[str, int], bytes], dict[tuple[str, int], bytes]]:
    plaintext: dict[tuple[str, int], bytes] = {}
    ciphertext: dict[tuple[str, int], bytes] = {}
    for agent_id in AGENT_IDS:
        for stage in range(1, STAGE_COUNT + 1):
            cell = tuple(
                item for item in assignments if item.agent_id == agent_id and item.stage == stage
            )
            plain = _stage_plaintext(cell)
            key = revised_key if variant_id == "rekey" and stage >= BOUNDARY_STAGE else base_key
            plaintext[agent_id, stage] = plain.encode("utf-8")
            ciphertext[agent_id, stage] = apply_mapping(plain, key).encode("utf-8")
    return plaintext, ciphertext


def _manipulation_masses(
    assignments: tuple[ParagraphAssignment, ...],
    changed_types: frozenset[str],
) -> tuple[float, dict[str, float]]:
    changed_by_agent = {agent_id: 0 for agent_id in AGENT_IDS}
    total_by_agent = {agent_id: 0 for agent_id in AGENT_IDS}
    for item in assignments:
        if item.stage < BOUNDARY_STAGE:
            continue
        counts = item.paragraph.counts()
        total_by_agent[item.agent_id] += item.paragraph.word_count
        changed_by_agent[item.agent_id] += sum(counts[word] for word in changed_types)
    masses = {
        agent_id: changed_by_agent[agent_id] / total_by_agent[agent_id] for agent_id in AGENT_IDS
    }
    total = sum(total_by_agent.values())
    return sum(changed_by_agent.values()) / total, masses


def validate_pair(
    *,
    stationary_stage_bytes: Mapping[tuple[str, int], bytes],
    rekey_stage_bytes: Mapping[tuple[str, int], bytes],
    boundary_stage: int,
    stationary_old_key_loss: float,
    rekey_old_key_loss: float,
    changed_token_mass_by_agent: Mapping[str, float],
) -> None:
    expected = {
        (agent_id, ordinal) for agent_id in AGENT_IDS for ordinal in range(1, STAGE_COUNT + 1)
    }
    if set(stationary_stage_bytes) != expected or set(rekey_stage_bytes) != expected:
        raise ValueError("Paired variants must contain complete matching stage geometry.")
    if boundary_stage != BOUNDARY_STAGE:
        raise ValueError("Paired variants must use the stage-four boundary.")
    if any(
        stationary_stage_bytes[key] != rekey_stage_bytes[key]
        for key in expected
        if key[1] < boundary_stage
    ):
        raise ValueError("Paired variants diverge before the manipulation boundary.")
    if stationary_old_key_loss != 0:
        raise ValueError("Stationary old-key loss must be zero.")
    if rekey_old_key_loss < MINIMUM_MANIPULATION_MASS:
        raise ValueError("Re-key old-key loss is below the declared minimum.")
    if set(changed_token_mass_by_agent) != set(AGENT_IDS) or any(
        mass < MINIMUM_MANIPULATION_MASS for mass in changed_token_mass_by_agent.values()
    ):
        raise ValueError("Every agent must receive the minimum post-boundary changed mass.")


@dataclass(frozen=True)
class PreparedPair:
    window_plaintext: str
    base_key: dict[str, str]
    revised_key: dict[str, str]
    plaintext_stage_bytes: dict[tuple[str, int], bytes]
    stationary_stage_bytes: dict[tuple[str, int], bytes]
    rekey_stage_bytes: dict[tuple[str, int], bytes]
    manipulation_check: dict[str, Any]


def _prepare_pair(design: BlockDesign) -> PreparedPair:
    window_plaintext = serialize_paragraphs(
        tuple(paragraph.text for paragraph in design.window.paragraphs)
    )
    base_key = stationary_key(
        sorted(set(_words(window_plaintext))),
        _seed_hex(design.block.seed, "base-key"),
    )
    changed_types = design.allocation.design.changed_types
    revised_key = revise_explicit_types(
        prior_key=base_key,
        changed_types=changed_types,
        stable_controls=tuple(match.control_type for match in design.allocation.design.controls),
        seed_hex=_seed_hex(design.block.seed, "rekey-stage-04"),
    )
    assignments = design.allocation.allocation.assignments
    plaintext_stage_bytes, stationary_stage_bytes = _variant_stage_bytes(
        assignments,
        base_key=base_key,
        revised_key=revised_key,
        variant_id="stationary",
    )
    rekey_plaintext, rekey_stage_bytes = _variant_stage_bytes(
        assignments,
        base_key=base_key,
        revised_key=revised_key,
        variant_id="rekey",
    )
    if plaintext_stage_bytes != rekey_plaintext:
        raise RuntimeError("Paired variants do not share one plaintext allocation.")
    rekey_loss, changed_mass_by_agent = _manipulation_masses(
        assignments,
        frozenset(changed_types),
    )
    validate_pair(
        stationary_stage_bytes=stationary_stage_bytes,
        rekey_stage_bytes=rekey_stage_bytes,
        boundary_stage=BOUNDARY_STAGE,
        stationary_old_key_loss=0.0,
        rekey_old_key_loss=rekey_loss,
        changed_token_mass_by_agent=changed_mass_by_agent,
    )
    return PreparedPair(
        window_plaintext=window_plaintext,
        base_key=base_key,
        revised_key=revised_key,
        plaintext_stage_bytes=plaintext_stage_bytes,
        stationary_stage_bytes=stationary_stage_bytes,
        rekey_stage_bytes=rekey_stage_bytes,
        manipulation_check={
            "schemaVersion": 1,
            "preBoundaryIdentical": True,
            "stationaryOldKeyLoss": 0.0,
            "rekeyOldKeyLoss": rekey_loss,
            "changedTokenMassByAgent": changed_mass_by_agent,
        },
    )


def _write_references(
    destination: Path,
    sources: tuple[SourceDefinition, ...],
    variant_id: str,
) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for document in build_reference_corpus(sources):
        relative = Path("variants") / variant_id / "references" / f"{document.document_id}.txt"
        content = document.content.encode("utf-8")
        artifacts.append(
            {
                "sourceId": document.source_id,
                "sourceSha256": document.sha256,
                "path": relative.as_posix(),
                **_write(destination / relative, content),
            }
        )
    return artifacts


def _complete_ciphertext(
    design: BlockDesign,
    *,
    base_key: dict[str, str],
    revised_key: dict[str, str],
    variant_id: str,
) -> bytes:
    assignment_by_ordinal = {
        item.paragraph.ordinal: item for item in design.allocation.allocation.assignments
    }
    rendered: list[str] = []
    for paragraph in design.window.paragraphs:
        assignment = assignment_by_ordinal[paragraph.ordinal]
        key = (
            revised_key
            if variant_id == "rekey" and assignment.stage >= BOUNDARY_STAGE
            else base_key
        )
        rendered.append(apply_mapping(paragraph.text, key))
    return serialize_paragraphs(tuple(rendered)).encode("utf-8")


def _build_variant(
    destination: Path,
    design: BlockDesign,
    *,
    variant_id: str,
    stage_bytes: Mapping[tuple[str, int], bytes],
    base_key: dict[str, str],
    revised_key: dict[str, str],
    reference_sources: tuple[SourceDefinition, ...],
    changed_symbols_sha256: str,
) -> BuildVariant:
    stages: list[EvidenceStage] = []
    for agent_id in AGENT_IDS:
        for ordinal in range(1, STAGE_COUNT + 1):
            relative = (
                Path("variants")
                / variant_id
                / "private"
                / agent_id
                / "stages"
                / stage_filename(ordinal, STAGE_COUNT)
            )
            content = stage_bytes[agent_id, ordinal]
            _write(destination / relative, content)
            stages.append(
                EvidenceStage(
                    agent_id=agent_id,
                    ordinal=ordinal,
                    key_version=(1 if variant_id == "rekey" and ordinal >= BOUNDARY_STAGE else 0),
                    source_path=relative,
                    token_count=len(_words(content.decode("utf-8"))),
                    sha256=sha256_hex(content),
                )
            )
    complete_path = Path(f"variants/{variant_id}/complete/ciphertext.txt")
    complete = _complete_ciphertext(
        design,
        base_key=base_key,
        revised_key=revised_key,
        variant_id=variant_id,
    )
    complete_record = _write(destination / complete_path, complete)
    references = _write_references(destination, reference_sources, variant_id)
    transitions = (
        ()
        if variant_id == "stationary"
        else (
            RekeyTransition(
                at_stage=BOUNDARY_STAGE,
                key_version=1,
                key_path=Path("oracle/keys/rekey-stage-04.json"),
                changed_symbols_sha256=changed_symbols_sha256,
            ),
        )
    )
    basis = {
        "schemaVersion": 1,
        "blockId": design.block.block_id,
        "variantId": variant_id,
        "allocationId": design.allocation.allocation.allocation_id,
        "windowSha256": design.window.sha256,
        "complete": complete_record,
        "references": references,
        "stages": [stage.to_dict() for stage in stages],
        "keyTransitions": [transition.to_dict() for transition in transitions],
    }
    return BuildVariant(
        variant_id=variant_id,
        build_id="build-" + sha256_hex(canonical_json_bytes(basis)),
        public_ciphertext_path=complete_path,
        reference_corpus_path=Path(f"variants/{variant_id}/references"),
        private_stage_roots={
            agent_id: Path(f"variants/{variant_id}/private/{agent_id}/stages")
            for agent_id in AGENT_IDS
        },
        stages=tuple(stages),
        key_transitions=transitions,
    )


def _build_into(
    root: Path,
    destination: Path,
    source_path: Path,
    phase: str,
    requested_block_id: str | None,
) -> PuzzleBuild:
    source = load_text_source(source_path)
    if phase not in {"calibration", "validation"}:
        raise ValueError("Puzzle phase must be calibration or validation.")
    block_id = requested_block_id or source.source_id
    block = BlockDefinition(
        block_id=block_id,
        phase=phase,
        source_id=source.source_id,
        references=REFERENCE_SOURCE_IDS,
        seed=int(source.sha256[:13], 16),
        window=WindowPin(0, 0, 0, ""),
        boundary_stage=BOUNDARY_STAGE,
    )
    registry = load_source_registry(root)
    try:
        reference_sources = tuple(registry[source_id] for source_id in REFERENCE_SOURCE_IDS)
    except KeyError as error:
        raise ValueError(f"Unknown registered corpus: {error.args[0]}") from error

    design = design_block(_paragraph_units(source), block, discover=True)
    pair = _prepare_pair(design)
    changed_types = design.allocation.design.changed_types

    _write(destination / "oracle/keys/base.json", canonical_json_bytes(pair.base_key))
    _write(
        destination / "oracle/keys/rekey-stage-04.json",
        canonical_json_bytes(pair.revised_key),
    )
    _write(destination / "oracle/plaintext.txt", pair.window_plaintext.encode("utf-8"))

    allocation_record = _allocation_record(design)
    allocation_bytes = canonical_json_bytes(allocation_record)
    _write(destination / "oracle/allocation.json", allocation_bytes)

    oracle_record = _oracle_record(design.allocation.design)
    oracle_bytes = canonical_json_bytes(oracle_record)
    _write(destination / "oracle/design.json", oracle_bytes)
    anchors_sha256 = sha256_hex(canonical_json_bytes(oracle_record["anchors"]))
    sentinels_sha256 = sha256_hex(canonical_json_bytes(oracle_record["sentinels"]))
    specialists_sha256 = sha256_hex(canonical_json_bytes(oracle_record["specialists"]))
    controls_sha256 = sha256_hex(canonical_json_bytes(oracle_record["controls"]))
    changed_symbols_sha256 = sha256_hex(canonical_json_bytes(list(changed_types)))

    for (agent_id, ordinal), content in pair.plaintext_stage_bytes.items():
        _write(
            destination / "oracle" / "checker" / agent_id / stage_filename(ordinal, STAGE_COUNT),
            content,
        )

    manipulation_bytes = canonical_json_bytes(pair.manipulation_check)
    _write(destination / "oracle/manipulation-check.json", manipulation_bytes)

    stationary = _build_variant(
        destination,
        design,
        variant_id="stationary",
        stage_bytes=pair.stationary_stage_bytes,
        base_key=pair.base_key,
        revised_key=pair.revised_key,
        reference_sources=reference_sources,
        changed_symbols_sha256=changed_symbols_sha256,
    )
    rekey = _build_variant(
        destination,
        design,
        variant_id="rekey",
        stage_bytes=pair.rekey_stage_bytes,
        base_key=pair.base_key,
        revised_key=pair.revised_key,
        reference_sources=reference_sources,
        changed_symbols_sha256=changed_symbols_sha256,
    )
    allocation_summary = AllocationSummary(
        allocation_id=design.allocation.allocation.allocation_id,
        evidence_tier=design.allocation.tier.name,
        control_tier=design.allocation.control_tier,
        metrics=_manifest_metrics(design.allocation),
        rejected_tiers=tuple(
            TierRejection(rejection.tier, rejection.reasons)
            for rejection in design.allocation.rejected_tiers
        ),
        path=Path("oracle/allocation.json"),
        sha256=sha256_hex(allocation_bytes),
    )
    oracle_summary = ManifestOracleDesign(
        path=Path("oracle/design.json"),
        sha256=sha256_hex(oracle_bytes),
        anchors_sha256=anchors_sha256,
        sentinels_sha256=sentinels_sha256,
        specialists_sha256=specialists_sha256,
        controls_sha256=controls_sha256,
    )
    manipulation = ManipulationCheck(
        path=Path("oracle/manipulation-check.json"),
        sha256=sha256_hex(manipulation_bytes),
        pre_boundary_identical=True,
        stationary_old_key_loss=0.0,
        rekey_old_key_loss=pair.manipulation_check["rekeyOldKeyLoss"],
        changed_token_mass_by_agent=pair.manipulation_check["changedTokenMassByAgent"],
    )
    pair_basis = {
        "schemaVersion": 4,
        "blockId": block.block_id,
        "sourceSha256": source.sha256,
        "windowSha256": design.window.sha256,
        "allocationSha256": allocation_summary.sha256,
        "oracleDesignSha256": oracle_summary.sha256,
        "manipulationSha256": manipulation.sha256,
        "stationaryBuildId": stationary.build_id,
        "rekeyBuildId": rekey.build_id,
    }
    build = PuzzleBuild(
        paired_build_id="paired-" + sha256_hex(canonical_json_bytes(pair_basis)),
        block_id=block.block_id,
        source=TargetSource(source.source_id, source.sha256),
        references=tuple(
            ReferenceSource(reference.source_id, reference.sha256)
            for reference in reference_sources
        ),
        seed=block.seed,
        window=BuildWindow(
            design.window.paragraph_start,
            design.window.paragraph_end,
            design.window.word_count,
            design.window.sha256,
        ),
        agent_ids=AGENT_IDS,
        stage_count=STAGE_COUNT,
        boundary_stage=BOUNDARY_STAGE,
        allocation=allocation_summary,
        oracle_design=oracle_summary,
        base_key_path=Path("oracle/keys/base.json"),
        manipulation_check=manipulation,
        stationary=stationary,
        rekey=rekey,
    )
    PuzzleBuild.from_dict(build.to_dict())
    _write(destination / "puzzle-build.json", canonical_json_bytes(build.to_dict()))
    return build


def build_puzzle(
    root: Path,
    output: Path,
    source: Path,
    phase: str,
    block_id: str | None = None,
) -> PuzzleBuild:
    root = root.resolve()
    output = output.resolve()
    _assert_available_output(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    try:
        build = _build_into(root, staging, source, phase, block_id)
        _publish_staging(staging, output)
        return build
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--phase", choices=("calibration", "validation"), default="validation")
    parser.add_argument("--block")
    args = parser.parse_args()
    build = build_puzzle(args.root, args.output, args.source, args.phase, args.block)
    result = {
        "pairedBuildId": build.paired_build_id,
        "buildPath": str(args.output.resolve()),
        "blockId": build.block_id,
        "agentIds": list(build.agent_ids),
        "stageCount": build.stage_count,
        "variants": {
            "stationary": build.stationary.build_id,
            "rekey": build.rekey.build_id,
        },
    }
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
