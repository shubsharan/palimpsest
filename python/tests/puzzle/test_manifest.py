from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import pytest
from palimpsest.puzzle.manifest import (
    AllocationMetrics,
    AllocationSummary,
    BuildVariant,
    BuildWindow,
    EvidenceStage,
    FixturePackage,
    ManipulationCheck,
    OracleDesign,
    ReferenceFile,
    ReferenceSource,
    RekeyTransition,
    TargetSource,
    stage_filename,
)
from palimpsest.serialization import canonical_json_bytes


def _variant(
    variant_id: str,
    *,
    agent_ids: tuple[str, ...],
    stage_count: int,
    rekey_from_stage: int | None,
) -> BuildVariant:
    prefix = f"variants/{variant_id}"
    stages = tuple(
        EvidenceStage(
            agent_id=agent_id,
            ordinal=ordinal,
            key_version=int(rekey_from_stage is not None and ordinal >= rekey_from_stage),
            source_path=Path(
                f"{prefix}/private/{agent_id}/stages/{stage_filename(ordinal, stage_count)}"
            ),
            token_count=100,
            sha256=(
                f"{agent_index * stage_count + ordinal:064x}"
                if rekey_from_stage is None or ordinal < rekey_from_stage
                else f"{1000 + agent_index * stage_count + ordinal:064x}"
            ),
        )
        for agent_index, agent_id in enumerate(agent_ids)
        for ordinal in range(1, stage_count + 1)
    )
    transitions = (
        ()
        if rekey_from_stage is None
        else (
            RekeyTransition(
                at_stage=rekey_from_stage,
                key_version=1,
                key_path=Path(f"oracle/keys/rekey-stage-{rekey_from_stage:02d}.json"),
                changed_symbols_sha256="b" * 64,
            ),
        )
    )
    return BuildVariant(
        variant_id=variant_id,
        rekey_from_stage=rekey_from_stage,
        build_id="build-" + ("c" if rekey_from_stage is None else "d") * 64,
        public_ciphertext_path=Path(f"{prefix}/complete/ciphertext.txt"),
        public_ciphertext_sha256="e" * 64,
        reference_corpus_path=Path(f"{prefix}/references"),
        reference_files=(
            ReferenceFile(
                source_id="reference",
                source_sha256="2" * 64,
                path=Path(f"{prefix}/references/reference-reference.txt"),
                byte_length=128,
                sha256="f" * 64,
            ),
        ),
        private_stage_roots={
            agent_id: Path(f"{prefix}/private/{agent_id}/stages") for agent_id in agent_ids
        },
        stages=stages,
        key_transitions=transitions,
    )


def _package(
    agent_ids: tuple[str, ...],
    stage_count: int,
    boundary_stage: int,
) -> FixturePackage:
    variants = {
        "stationary": _variant(
            "stationary",
            agent_ids=agent_ids,
            stage_count=stage_count,
            rekey_from_stage=None,
        ),
        "rekey": _variant(
            "rekey",
            agent_ids=agent_ids,
            stage_count=stage_count,
            rekey_from_stage=boundary_stage,
        ),
    }
    package = FixturePackage(
        fixture_id=f"fixture-{len(agent_ids)}-{stage_count}",
        content_digest="0" * 64,
        source=TargetSource("source", "1" * 64),
        references=(ReferenceSource("reference", "2" * 64),),
        seed=17,
        window=BuildWindow(1, 180, 18_000, "3" * 64),
        agent_ids=agent_ids,
        stage_count=stage_count,
        allocation=AllocationSummary(
            allocation_id="allocation-" + "4" * 64,
            tier="declared",
            metrics=AllocationMetrics(
                region_deviation=0.1,
                stage_deviation=0.2,
                solo_changed_set_coverage=0.5,
                min_owner_share=0.5,
                anchor_count=1,
                sentinel_count=1,
                specialist_counts={agent_id: 1 for agent_id in agent_ids},
                min_owner_occurrences_per_region=1,
                min_sentinel_occurrences_per_agent_region=1,
                unmatched_control_count=0,
                max_control_distance=0.4,
            ),
            rejected_tiers=(),
            path=Path("oracle/allocation.json"),
            sha256="5" * 64,
        ),
        oracle_design=OracleDesign(
            path=Path("oracle/design.json"),
            sha256="6" * 64,
            anchors_sha256="7" * 64,
            sentinels_sha256="8" * 64,
            specialists_sha256="9" * 64,
            controls_sha256="a" * 64,
        ),
        base_key_path=Path("oracle/keys/base.json"),
        manipulation_check=ManipulationCheck(
            path=Path("oracle/manipulation-check.json"),
            sha256="b" * 64,
            pre_boundary_identical=True,
            stationary_old_key_loss=0,
            rekey_old_key_loss=0.2,
            changed_token_mass_by_agent={agent_id: 0.2 for agent_id in agent_ids},
        ),
        variants=variants,
    )
    return replace(package, content_digest=package.computed_content_digest())


@pytest.mark.parametrize(
    ("agent_ids", "stage_count", "boundary_stage"),
    [
        (("beta", "alpha"), 3, 2),
        (("alpha", "beta", "gamma", "delta"), 8, 5),
    ],
)
def test_fixture_package_round_trips_variable_geometry(
    agent_ids: tuple[str, ...],
    stage_count: int,
    boundary_stage: int,
) -> None:
    package = _package(agent_ids, stage_count, boundary_stage)

    decoded = FixturePackage.from_dict(package.to_dict())

    assert decoded == package
    assert decoded.content_digest == decoded.computed_content_digest()
    assert len(decoded.variants["stationary"].stages) == len(agent_ids) * stage_count
    assert decoded.variants["rekey"].rekey_from_stage == boundary_stage
    assert canonical_json_bytes(decoded.to_dict()) == canonical_json_bytes(package.to_dict())


def test_content_digest_detects_package_metadata_drift() -> None:
    package = _package(("alpha", "beta"), 3, 2)
    record = package.to_dict()
    record["seed"] = 18

    with pytest.raises(ValueError, match="contentDigest"):
        FixturePackage.from_dict(record)


def test_variant_serializes_verifiable_public_artifacts() -> None:
    package = _package(("alpha", "beta"), 3, 2)
    record = package.to_dict()["variants"]["stationary"]

    assert record["publicCiphertextSha256"] == "e" * 64
    assert record["referenceFiles"] == [
        {
            "sourceId": "reference",
            "sourceSha256": "2" * 64,
            "path": "variants/stationary/references/reference-reference.txt",
            "byteLength": 128,
            "sha256": "f" * 64,
        }
    ]


def test_variant_map_is_not_limited_to_legacy_names() -> None:
    package = _package(("alpha", "beta"), 3, 2)
    renamed = replace(
        package,
        variants={
            "control": _variant(
                "control",
                agent_ids=package.agent_ids,
                stage_count=package.stage_count,
                rekey_from_stage=None,
            ),
            "shift-at-two": _variant(
                "shift-at-two",
                agent_ids=package.agent_ids,
                stage_count=package.stage_count,
                rekey_from_stage=2,
            ),
        },
        content_digest="0" * 64,
    )
    renamed = replace(renamed, content_digest=renamed.computed_content_digest())

    assert FixturePackage.from_dict(renamed.to_dict()) == renamed


def test_stage_filename_scales_with_declared_stage_count() -> None:
    assert stage_filename(1, 8) == "stage-01.txt"
    assert stage_filename(100, 120) == "stage-100.txt"
