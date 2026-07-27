from __future__ import annotations

import json
from pathlib import Path

import pytest
from palimpsest.gate_c.artifacts import (
    AttemptIdentity,
    create_attempt,
    finalize_attempt,
    resolve_attempt,
    resolve_terminal_attempt,
)


def identity(digit: str, run_id: str) -> AttemptIdentity:
    return AttemptIdentity(digit * 64, run_id)


def test_attempts_are_immutable_and_current_is_only_a_pointer(tmp_path: Path) -> None:
    attempts_root = tmp_path / "attempts"
    current_path = tmp_path / "current.json"
    first = identity("a", "run-1")
    first_path = create_attempt(
        attempts_root=attempts_root,
        current_path=current_path,
        identity=first,
        started_at="2026-07-26T00:00:00Z",
    )
    first_bytes = (first_path / "attempt.json").read_bytes()

    second = identity("a", "run-2")
    second_path = create_attempt(
        attempts_root=attempts_root,
        current_path=current_path,
        identity=second,
        started_at="2026-07-26T00:01:00Z",
    )

    assert first_path != second_path
    assert (first_path / "attempt.json").read_bytes() == first_bytes
    pointer = json.loads(current_path.read_text(encoding="utf-8"))
    assert pointer["attemptId"] == second.attempt_id
    assert pointer["evidence"] is False
    assert resolve_attempt(attempts_root=attempts_root, identity=first) == first_path


def test_attempt_directory_cannot_be_reused(tmp_path: Path) -> None:
    kwargs = {
        "attempts_root": tmp_path / "attempts",
        "current_path": tmp_path / "current.json",
        "identity": identity("b", "run-1"),
        "started_at": "2026-07-26T00:00:00Z",
    }
    create_attempt(**kwargs)
    with pytest.raises(FileExistsError):
        create_attempt(**kwargs)


def test_terminal_manifest_binds_the_exact_output_set(tmp_path: Path) -> None:
    attempt_identity = identity("d", "run-1")
    attempts_root = tmp_path / "attempts"
    path = create_attempt(
        attempts_root=attempts_root,
        current_path=tmp_path / "current.json",
        identity=attempt_identity,
        started_at="2026-07-26T00:00:00Z",
    )
    (path / "output.txt").write_text("evidence", encoding="utf-8")
    finalize_attempt(
        path=path,
        identity=attempt_identity,
        status="scored",
        terminal_fields={"classification": "stop"},
    )
    assert (
        resolve_terminal_attempt(
            attempts_root=attempts_root,
            identity=attempt_identity,
        )[0]
        == path
    )
    (path / "stale.txt").write_text("contamination", encoding="utf-8")
    with pytest.raises(ValueError, match="exact attempt output set"):
        resolve_terminal_attempt(
            attempts_root=attempts_root,
            identity=attempt_identity,
        )


def test_resolver_rejects_manifest_identity_mismatch(tmp_path: Path) -> None:
    expected = identity("c", "run-1")
    path = create_attempt(
        attempts_root=tmp_path / "attempts",
        current_path=tmp_path / "current.json",
        identity=expected,
        started_at="2026-07-26T00:00:00Z",
    )
    manifest = json.loads((path / "attempt.json").read_text(encoding="utf-8"))
    manifest["runId"] = "run-2"
    (path / "attempt.json").write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ValueError, match="runId"):
        resolve_attempt(attempts_root=tmp_path / "attempts", identity=expected)


@pytest.mark.parametrize(
    ("digest", "run_id"),
    [("A" * 64, "run-1"), ("a" * 63, "run-1"), ("a" * 64, "../run")],
)
def test_attempt_identity_rejects_unsafe_components(digest: str, run_id: str) -> None:
    with pytest.raises(ValueError):
        AttemptIdentity(digest, run_id)
