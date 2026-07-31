from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from palimpsest.puzzle.manifest import (
    AllocationMetrics,
    AllocationSummary,
    BuildVariant,
    BuildWindow,
    EvidenceStage,
    ManipulationCheck,
    OracleDesign,
    PuzzleBuild,
    ReferenceSource,
    RekeyTransition,
    TargetSource,
    TierRejection,
    make_agent_ids,
)
from palimpsest.serialization import canonical_json_bytes

AGENT_IDS = ("agent-1", "agent-2", "agent-3")
DIGEST = "a" * 64


def _stages(variant_id: str) -> tuple[EvidenceStage, ...]:
    post_boundary_offset = 0 if variant_id == "stationary" else 18
    return tuple(
        EvidenceStage(
            agent_id=agent_id,
            ordinal=ordinal,
            key_version=1 if variant_id == "rekey" and ordinal >= 4 else 0,
            source_path=Path(
                f"variants/{variant_id}/private/{agent_id}/stages/stage-{ordinal:02d}.txt"
            ),
            token_count=200,
            sha256=(
                f"{agent_index * 6 + ordinal:064x}"
                if ordinal < 4
                else f"{100 + post_boundary_offset + agent_index * 6 + ordinal:064x}"
            ),
        )
        for agent_index, agent_id in enumerate(AGENT_IDS)
        for ordinal in range(1, 7)
    )


def _variant(variant_id: str) -> BuildVariant:
    transition = (
        ()
        if variant_id == "stationary"
        else (
            RekeyTransition(
                at_stage=4,
                key_version=1,
                key_path=Path("oracle/keys/rekey-stage-04.json"),
                changed_symbols_sha256="b" * 64,
            ),
        )
    )
    return BuildVariant(
        variant_id=variant_id,
        build_id="build-" + ("c" if variant_id == "stationary" else "d") * 64,
        public_ciphertext_path=Path(f"variants/{variant_id}/complete/ciphertext.txt"),
        reference_corpus_path=Path(f"variants/{variant_id}/references"),
        private_stage_roots={
            agent_id: Path(f"variants/{variant_id}/private/{agent_id}/stages")
            for agent_id in AGENT_IDS
        },
        stages=_stages(variant_id),
        key_transitions=transition,
    )


def _build() -> PuzzleBuild:
    return PuzzleBuild(
        paired_build_id="paired-" + "e" * 64,
        block_id="calibration-odd-women",
        source=TargetSource("odd-women", "f" * 64),
        references=(
            ReferenceSource("middlemarch", "1" * 64),
            ReferenceSource("moby-dick", "2" * 64),
            ReferenceSource("jane-eyre", "3" * 64),
        ),
        seed=130013,
        window=BuildWindow(
            paragraph_start=10,
            paragraph_end=80,
            word_count=18_000,
            sha256="4" * 64,
        ),
        agent_ids=AGENT_IDS,
        stage_count=6,
        boundary_stage=4,
        allocation=AllocationSummary(
            allocation_id="allocation-" + "5" * 64,
            evidence_tier="balanced",
            control_tier="balanced",
            metrics=AllocationMetrics(
                region_deviation=0.05,
                stage_deviation=0.15,
                solo_changed_set_coverage=0.6,
                min_owner_share=0.61,
                anchor_count=12,
                sentinel_count=6,
                specialist_counts={agent_id: 3 for agent_id in AGENT_IDS},
                min_owner_occurrences_per_region=2,
                min_sentinel_occurrences_per_agent_region=2,
                unmatched_control_count=0,
                max_control_distance=0.2,
            ),
            rejected_tiers=(TierRejection("strict", ("region-deviation", "stage-deviation")),),
            path=Path("oracle/allocation.json"),
            sha256="6" * 64,
        ),
        oracle_design=OracleDesign(
            path=Path("oracle/design.json"),
            sha256="7" * 64,
            anchors_sha256="8" * 64,
            sentinels_sha256="9" * 64,
            specialists_sha256="a" * 64,
            controls_sha256="b" * 64,
        ),
        base_key_path=Path("oracle/keys/base.json"),
        manipulation_check=ManipulationCheck(
            path=Path("oracle/manipulation-check.json"),
            sha256="c" * 64,
            pre_boundary_identical=True,
            stationary_old_key_loss=0.0,
            rekey_old_key_loss=0.2,
            changed_token_mass_by_agent={agent_id: 0.2 for agent_id in AGENT_IDS},
        ),
        stationary=_variant("stationary"),
        rekey=_variant("rekey"),
    )


def _manifest() -> dict[str, Any]:
    return _build().to_dict()


def test_make_agent_ids_is_canonical_and_numeric() -> None:
    assert make_agent_ids(3) == AGENT_IDS
    assert make_agent_ids(10)[-1] == "agent-10"
    with pytest.raises(ValueError, match="at least two"):
        make_agent_ids(1)


def test_schema_v4_paired_manifest_round_trips_canonical_json() -> None:
    build = _build()
    encoded = canonical_json_bytes(build.to_dict())

    decoded = PuzzleBuild.from_dict(json.loads(encoded))

    assert decoded == build
    assert decoded.to_dict()["schemaVersion"] == 4
    assert decoded.to_dict()["variants"]["stationary"]["keyTransitions"] == []
    assert len(decoded.stationary.stages) == 18
    assert len(decoded.rekey.stages) == 18


@pytest.mark.parametrize(
    ("field", "value", "match"),
    [
        ("schemaVersion", 2, "schema version"),
        ("agentIds", ["agent-1", "agent-2"], "exactly three"),
        ("stageCount", 5, "exactly 6"),
        ("boundaryStage", 3, "exactly 4"),
        ("pairedBuildId", "paired-nope", "lowercase SHA-256"),
        ("baseKeyPath", "../base.json", "safe relative path"),
    ],
)
def test_manifest_rejects_invalid_top_level_contract(field: str, value: object, match: str) -> None:
    manifest = _manifest()
    manifest[field] = value

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


def test_schema_v3_rejects_release_timing_fields() -> None:
    manifest = _manifest()
    manifest["stageIntervalMs"] = 20

    with pytest.raises(ValueError, match="unknown field stageIntervalMs"):
        PuzzleBuild.from_dict(manifest)

    stage = manifest["variants"]["rekey"]["stages"][0]
    stage["releaseOffsetMs"] = 0
    del manifest["stageIntervalMs"]

    with pytest.raises(ValueError, match="unknown field releaseOffsetMs"):
        PuzzleBuild.from_dict(manifest)


def test_manifest_requires_ordered_rejected_tiers() -> None:
    manifest = _manifest()
    manifest["allocation"]["rejectedTiers"] = [{"tier": "balanced", "reasons": ["stage-deviation"]}]

    with pytest.raises(ValueError, match="earlier tiers"):
        PuzzleBuild.from_dict(manifest)


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (
            lambda manifest: manifest["allocation"].__setitem__(
                "path", "variants/rekey/allocation.json"
            ),
            "oracle/allocation.json",
        ),
        (
            lambda manifest: manifest["oracleDesign"].__setitem__("anchorsSha256", "ABC"),
            "lowercase SHA-256",
        ),
        (
            lambda manifest: manifest["manipulationCheck"]["changedTokenMassByAgent"].__setitem__(
                "agent-1", 0.14
            ),
            "between 0.15 and 1",
        ),
    ],
)
def test_manifest_rejects_invalid_oracle_records(
    mutate: Callable[[dict[str, Any]], None], match: str
) -> None:
    manifest = _manifest()
    mutate(manifest)

    with pytest.raises(ValueError, match=match):
        PuzzleBuild.from_dict(manifest)


def test_manifest_requires_exact_variant_keys_and_paths() -> None:
    manifest = _manifest()
    manifest["variants"]["stationary"]["publicCiphertextPath"] = (
        "variants/rekey/complete/ciphertext.txt"
    )

    with pytest.raises(ValueError, match="stationary public ciphertext path"):
        PuzzleBuild.from_dict(manifest)

    manifest = _manifest()
    manifest["variants"]["extra"] = manifest["variants"]["stationary"]

    with pytest.raises(ValueError, match="unknown field extra"):
        PuzzleBuild.from_dict(manifest)


def test_manifest_requires_exact_variant_key_schedules() -> None:
    manifest = _manifest()
    manifest["variants"]["stationary"]["stages"][9]["keyVersion"] = 1

    with pytest.raises(ValueError, match="key version"):
        PuzzleBuild.from_dict(manifest)

    manifest = _manifest()
    manifest["variants"]["rekey"]["keyTransitions"] = []

    with pytest.raises(ValueError, match="one stage-four key transition"):
        PuzzleBuild.from_dict(manifest)


def test_manifest_requires_pre_boundary_stage_identity() -> None:
    manifest = _manifest()
    manifest["variants"]["rekey"]["stages"][1]["sha256"] = "f" * 64

    with pytest.raises(ValueError, match="pre-boundary stage digests"):
        PuzzleBuild.from_dict(manifest)


def test_selected_tier_metrics_must_satisfy_the_tier() -> None:
    build = _build()
    metrics = replace(build.allocation.metrics, max_control_distance=0.3)

    with pytest.raises(ValueError, match="balanced control tier"):
        replace(build.allocation, metrics=metrics)
