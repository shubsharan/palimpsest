from __future__ import annotations

from types import SimpleNamespace

import pytest
from palimpsest.contracts import canonical_json_bytes
from palimpsest.contracts.canonical_json import ContractInputError
from palimpsest.gate_b import frontier_agent_runner
from palimpsest.gate_b.frontier_agent_runner import (
    SolverTurn,
    _apply_partial_mapping,
    _create_attempt,
    _initial_prompt,
    _instance_lock,
    _revision_prompt,
    _safe_stream_event,
    _supersede_abandoned_current,
    _validate_mapping,
    _validation_errors,
    _write_attempt_status,
    _write_current,
)
from pydantic import ValidationError


def test_validate_mapping_enforces_vocabulary_bijection_and_no_fixed_points() -> None:
    assert _validate_mapping(
        {"CIPHER-A": "PLAIN-A", "cipher-b": "plain-b"},
        {"cipher-a", "cipher-b", "plain-a", "plain-b"},
    ) == {"cipher-a": "plain-a", "cipher-b": "plain-b"}
    with pytest.raises(ValueError, match="one-to-one"):
        _validate_mapping(
            {"cipher-a": "plain-a", "cipher-b": "plain-a"},
            {"cipher-a", "cipher-b", "plain-a"},
        )
    with pytest.raises(ValueError, match="fixed point"):
        _validate_mapping(
            {"same": "same"},
            {"same"},
        )
    with pytest.raises(ValueError, match="vocabulary"):
        _validate_mapping(
            {"outside": "plain-a"},
            {"plain-a"},
        )


def test_partial_mapping_preserves_unknown_tokens_and_rendering() -> None:
    assert (
        _apply_partial_mapping(
            "Cipher, UNKNOWN!\nCipher.",
            {"cipher": "plain"},
        )
        == "Plain, UNKNOWN!\nPlain."
    )


def test_prompts_require_file_backed_python_work_without_embedding_ciphertext() -> None:
    initial = _initial_prompt()
    revision = _revision_prompt(sequence=1)
    assert "/mnt/data/cipher.txt" in initial
    assert "/mnt/data/vocabulary.json" in initial
    assert "curly apostrophes" in initial
    assert "/mnt/data/solver.py" in initial
    assert "no more than 15" in initial
    assert "no more than 15" in revision
    assert "must use the python tool" in initial
    assert "/mnt/data/reconstruction.txt" in revision
    assert "CIPHERTEXT\n" not in initial


def test_stream_filter_exposes_summaries_and_code_but_not_raw_reasoning() -> None:
    summary = SimpleNamespace(
        type="response.reasoning_summary_text.delta",
        model_dump=lambda **_: {"type": "response.reasoning_summary_text.delta", "delta": "why"},
    )
    raw_reasoning = SimpleNamespace(
        type="response.reasoning_text.delta",
        model_dump=lambda **_: {"type": "response.reasoning_text.delta", "delta": "private"},
    )
    code = SimpleNamespace(
        type="response.code_interpreter_call_code.delta",
        model_dump=lambda **_: {
            "type": "response.code_interpreter_call_code.delta",
            "delta": "print(1)",
        },
    )
    assert _safe_stream_event(summary, 1.0) is not None
    assert _safe_stream_event(code, 2.0) is not None
    assert _safe_stream_event(raw_reasoning, 3.0) is None


def test_attempt_directories_are_fresh_immutable_and_current_is_atomic(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(frontier_agent_runner, "ROOT", tmp_path)
    monkeypatch.setattr(
        frontier_agent_runner,
        "GATE_B_ROOT",
        tmp_path / "artifacts" / "gate-b",
    )
    digest = "a" * 64
    first = _create_attempt(
        "instance-amber",
        digest,
        run_id="run-first",
        started_at="2026-07-26T21:00:00Z",
    )
    (first.root / "mapping-0.json").write_bytes(b'{"cipher":"plain"}')
    _write_attempt_status(first, "completed")
    _write_current(first, "completed")
    first_bytes = {
        path.relative_to(first.root): path.read_bytes()
        for path in first.root.rglob("*")
        if path.is_file()
    }

    second = _create_attempt(
        "instance-amber",
        digest,
        run_id="run-second",
        started_at="2026-07-26T22:00:00Z",
    )

    assert not (second.root / "mapping-0.json").exists()
    assert first_bytes == {
        path.relative_to(first.root): path.read_bytes()
        for path in first.root.rglob("*")
        if path.is_file()
    }
    current = frontier_agent_runner.json.loads(
        (second.instance_root / "current.json").read_text(encoding="utf-8")
    )
    assert current["runId"] == "run-second"
    assert current["status"] == "running"
    assert not list(second.instance_root.glob(".current.json.*.tmp"))
    with pytest.raises(FileExistsError):
        _create_attempt("instance-amber", digest, run_id="run-first")


def test_abandoned_running_attempt_becomes_superseded(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(frontier_agent_runner, "ROOT", tmp_path)
    monkeypatch.setattr(
        frontier_agent_runner,
        "GATE_B_ROOT",
        tmp_path / "artifacts" / "gate-b",
    )
    attempt = _create_attempt("instance-amber", "b" * 64, run_id="abandoned")

    _supersede_abandoned_current(attempt.instance_root)

    status = frontier_agent_runner.json.loads(
        (attempt.root / "status.json").read_text(encoding="utf-8")
    )
    current = frontier_agent_runner.json.loads(
        (attempt.instance_root / "current.json").read_text(encoding="utf-8")
    )
    assert status["status"] == "superseded"
    assert current["status"] == "superseded"


def test_instance_lock_preserves_frozen_contract_exceptions(tmp_path) -> None:
    instance_root = tmp_path / "instance-amber"

    with (
        pytest.raises(ContractInputError, match="not canonical"),
        _instance_lock(instance_root),
    ):
        raise ContractInputError("type", "/value", "not canonical")

    with _instance_lock(instance_root):
        pass


def test_validation_diagnostics_are_canonical_json_safe() -> None:
    try:
        SolverTurn.model_validate_json("")
    except ValidationError as error:
        diagnostics = _validation_errors(error)
    else:
        raise AssertionError("Empty solver response was unexpectedly valid.")

    assert canonical_json_bytes(diagnostics)
    assert all("input" not in diagnostic and "ctx" not in diagnostic for diagnostic in diagnostics)
