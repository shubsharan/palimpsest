from __future__ import annotations

from pathlib import Path

import pytest
from palimpsest.contracts import canonical_json_bytes
from palimpsest.gate_b import pre_solve_canary
from palimpsest.gate_b.config import GateBInstanceConfig
from palimpsest.gate_b.pre_solve_canary import (
    AdmissionTurn,
    classify_admission,
    merge_admission_summary,
    record_canary_failure,
    require_admitted_matrix,
)


def _config(*, role: str, title: str = "Example Work") -> GateBInstanceConfig:
    return GateBInstanceConfig(
        diagnostic_role=role,
        entity_review_path=Path("review.json"),
        instance_id="instance-fixture",
        source_id="fixture",
        source_path=Path("source.txt"),
        source_format="gutenberg-text",
        source_tier="gutenberg",
        title=title,
        author="Example Author",
        catalog_url="https://example.test/catalog",
        download_url="https://example.test/source",
        rights="public domain",
        seed_hex="11" * 32,
        interior_chapter_index=0,
    )


def _turn(*, candidates: list[str], excerpt: str = "") -> AdmissionTurn:
    return AdmissionTurn(
        work_candidates=candidates,
        author_candidates=[],
        reconstructed_excerpt=excerpt,
        notes=[],
    )


def test_unrecognized_role_is_admitted_without_title_or_alignment() -> None:
    result = classify_admission(
        _config(role="unrecognized-non-literary"),
        _turn(candidates=["A Different Manual"]),
        " ".join(f"truth{index}" for index in range(100)),
    )
    assert result == {
        "titleIdentified": False,
        "exactAlignedReconstruction": False,
        "observedRecognized": False,
        "expectedRecognized": False,
        "admitted": True,
    }


def test_unrecognized_role_is_rejected_on_exact_title() -> None:
    result = classify_admission(
        _config(role="unrecognized-literary", title="Moby-Dick; or, The Whale"),
        _turn(candidates=["Moby Dick"]),
        "unrelated text",
    )
    assert result["titleIdentified"] is True
    assert result["admitted"] is False


def test_recognized_role_accepts_exact_aligned_excerpt() -> None:
    truth = " ".join(f"word{index}" for index in range(100))
    excerpt = " ".join(f"word{index}" for index in range(20, 60))
    result = classify_admission(
        _config(role="recognized-literary"),
        _turn(candidates=[], excerpt=excerpt),
        truth,
    )
    assert result["exactAlignedReconstruction"] is True
    assert result["admitted"] is True


def test_matrix_guard_rejects_partial_admission(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    digest = "a" * 64
    monkeypatch.setattr(pre_solve_canary, "GATE_B_ROOT", tmp_path)
    monkeypatch.setattr(
        pre_solve_canary,
        "GATE_B_INSTANCES",
        (
            _config(role="unrecognized-literary"),
            GateBInstanceConfig(
                **{
                    **_config(role="recognized-literary").__dict__,
                    "instance_id": "instance-second",
                }
            ),
        ),
    )
    (tmp_path / "predeclaration.json").write_bytes(
        canonical_json_bytes({"predeclarationDigest": digest})
    )
    (tmp_path / "admission").mkdir()
    (tmp_path / "admission" / "summary.json").write_bytes(
        canonical_json_bytes(
            {
                "schemaVersion": 1,
                "predeclarationDigest": digest,
                "allAdmitted": True,
                "results": [
                    {
                        "instanceId": "instance-fixture",
                        "predeclarationDigest": digest,
                        "admitted": True,
                    }
                ],
            }
        )
    )
    with pytest.raises(RuntimeError, match="not fully admitted"):
        require_admitted_matrix()


def test_summary_accumulates_results_and_requires_complete_matrix(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    digest = "b" * 64
    configs = tuple(
        GateBInstanceConfig(
            **{
                **_config(role=role).__dict__,
                "instance_id": instance_id,
            }
        )
        for instance_id, role in (
            ("instance-amber", "unrecognized-literary"),
            ("instance-birch", "recognized-literary"),
            ("instance-cobalt", "unrecognized-non-literary"),
        )
    )
    monkeypatch.setattr(pre_solve_canary, "GATE_B_ROOT", tmp_path)
    monkeypatch.setattr(pre_solve_canary, "GATE_B_INSTANCES", configs)
    (tmp_path / "predeclaration.json").write_bytes(
        canonical_json_bytes({"predeclarationDigest": digest})
    )
    first = merge_admission_summary(
        [
            {
                "instanceId": "instance-cobalt",
                "predeclarationDigest": digest,
                "admitted": True,
            }
        ]
    )
    assert first["matrixComplete"] is False
    assert first["allAdmitted"] is False
    (tmp_path / "admission").mkdir()
    (tmp_path / "admission" / "summary.json").write_bytes(canonical_json_bytes(first))
    complete = merge_admission_summary(
        [
            {
                "instanceId": "instance-amber",
                "predeclarationDigest": digest,
                "admitted": True,
            },
            {
                "instanceId": "instance-birch",
                "predeclarationDigest": digest,
                "admitted": True,
            },
        ]
    )
    assert complete["matrixComplete"] is True
    assert complete["allAdmitted"] is True
    assert [result["instanceId"] for result in complete["results"]] == [
        "instance-amber",
        "instance-birch",
        "instance-cobalt",
    ]


def test_api_failure_is_persisted_without_success_shape(tmp_path: Path) -> None:
    live_path = tmp_path / "live.log"
    live_path.write_text("status=starting\n", encoding="utf-8")
    record_canary_failure(
        tmp_path,
        live_path,
        digest="c" * 64,
        instance_id="instance-cobalt",
        error=RuntimeError("quota exhausted"),
    )
    failure = __import__("json").loads((tmp_path / "failure.json").read_text(encoding="utf-8"))
    assert failure["errorType"] == "RuntimeError"
    assert failure["errorMessage"] == "quota exhausted"
    assert not (tmp_path / "result.json").exists()
    assert live_path.read_text(encoding="utf-8").endswith(
        "status=failed\nerror_type=RuntimeError\n"
    )
