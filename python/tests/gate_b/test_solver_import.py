from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.gate_b.solver_import import import_checkpoint_bundle


def _write_bundle(root: Path, *, elapsed: list[float]) -> Path:
    root.mkdir()
    checkpoints = []
    reconstruction = " ".join(["word"] * 20_000)
    for sequence, elapsed_seconds in enumerate(elapsed):
        (root / f"reconstruction-{sequence}.txt").write_text(
            reconstruction,
            encoding="utf-8",
        )
        for name, value in (
            (f"mapping-{sequence}.json", {}),
            (f"tools-{sequence}.json", []),
            (f"claims-{sequence}.json", []),
            (f"usage-{sequence}.json", {"activeSeconds": elapsed_seconds}),
        ):
            (root / name).write_text(json.dumps(value), encoding="utf-8")
        checkpoints.append(
            {
                "sequence": sequence,
                "trustedElapsedSeconds": elapsed_seconds,
                "reconstructionPath": f"reconstruction-{sequence}.txt",
                "mappingPath": f"mapping-{sequence}.json",
                "toolEventsPath": f"tools-{sequence}.json",
                "identificationClaimsPath": f"claims-{sequence}.json",
                "usagePath": f"usage-{sequence}.json",
            }
        )
    (root / "manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "instanceId": "instance-amber",
                "condition": "human-tools",
                "solverIdentity": "fixture-human",
                "checkpoints": checkpoints,
            }
        ),
        encoding="utf-8",
    )
    return root


def _write_agent_bundle(root: Path, *, checkpoint_run_id: str = "run-1") -> Path:
    digest = "c" * 64
    run_id = "run-1"
    bundle = root / "agent" / "instance-amber" / digest / run_id
    bundle.mkdir(parents=True)
    reconstruction = " ".join(["word"] * 20_000)
    (bundle / "reconstruction-0.txt").write_text(reconstruction, encoding="utf-8")
    for name, value in (
        ("mapping-0.json", {}),
        ("tools-0.json", []),
        ("claims-0.json", []),
        ("usage-0.json", {"activeSeconds": 60}),
    ):
        (bundle / name).write_text(json.dumps(value), encoding="utf-8")
    identity = {
        "instanceId": "instance-amber",
        "predeclarationDigest": digest,
        "runId": run_id,
        "attemptId": "instance-amber-frontier-agent-tools-run-1",
        "producerVersion": "frontier-agent-runner/2.0.0",
    }
    (bundle / "status.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                **identity,
                "attemptPath": str(bundle),
                "startTime": "2026-07-26T21:00:00Z",
                "endTime": "2026-07-26T21:01:00Z",
                "status": "completed",
            }
        ),
        encoding="utf-8",
    )
    (bundle / "manifest.json").write_text(
        json.dumps(
            {
                "schemaVersion": 2,
                **identity,
                "condition": "frontier-agent-tools",
                "solverIdentity": "fixture-agent",
                "terminalStatus": "completed",
                "checkpoints": [
                    {
                        "sequence": 0,
                        "trustedElapsedSeconds": 60,
                        "reconstructionPath": "reconstruction-0.txt",
                        "mappingPath": "mapping-0.json",
                        "toolEventsPath": "tools-0.json",
                        "identificationClaimsPath": "claims-0.json",
                        "usagePath": "usage-0.json",
                        "predeclarationDigest": digest,
                        "runId": checkpoint_run_id,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return bundle


def test_solver_import_accepts_strictly_ordered_checkpoints(tmp_path: Path) -> None:
    records = import_checkpoint_bundle(_write_bundle(tmp_path / "bundle", elapsed=[60, 120]))
    assert [record["sequence"] for record in records] == [0, 1]


def test_solver_import_rejects_nonmonotonic_elapsed_work(tmp_path: Path) -> None:
    bundle = _write_bundle(tmp_path / "bundle", elapsed=[60, 59])
    try:
        import_checkpoint_bundle(bundle)
    except ValueError as error:
        assert "elapsed" in str(error)
    else:
        raise AssertionError("Nonmonotonic checkpoint time was accepted.")


def test_agent_import_accepts_one_explicit_completed_attempt(tmp_path: Path) -> None:
    bundle = _write_agent_bundle(tmp_path)

    records = import_checkpoint_bundle(bundle, expected_predeclaration_digest="c" * 64)

    assert [record["sequence"] for record in records] == [0]


def test_agent_import_rejects_checkpoint_from_another_run(tmp_path: Path) -> None:
    bundle = _write_agent_bundle(tmp_path, checkpoint_run_id="stale-run")

    with pytest.raises(ValueError, match="run ID"):
        import_checkpoint_bundle(bundle, expected_predeclaration_digest="c" * 64)


def test_agent_import_rejects_stale_predeclaration(tmp_path: Path) -> None:
    bundle = _write_agent_bundle(tmp_path)

    with pytest.raises(ValueError, match="current predeclaration"):
        import_checkpoint_bundle(bundle, expected_predeclaration_digest="d" * 64)


def test_agent_import_rejects_legacy_flat_directory(tmp_path: Path) -> None:
    legacy = tmp_path / "agent" / "instance-amber"
    legacy.mkdir(parents=True)
    (legacy / "mapping-0.json").write_text("{}", encoding="utf-8")

    with pytest.raises(ValueError, match="Flat frontier-agent"):
        import_checkpoint_bundle(legacy)
