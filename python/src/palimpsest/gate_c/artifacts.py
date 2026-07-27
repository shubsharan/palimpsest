from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex
from palimpsest.gate_b.artifacts import write_canonical as _write_canonical
from palimpsest.gate_b.artifacts import write_text as _write_text

SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
RUN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


@dataclass(frozen=True)
class AttemptIdentity:
    declaration_digest: str
    run_id: str

    def __post_init__(self) -> None:
        if not SHA256_PATTERN.fullmatch(self.declaration_digest):
            raise ValueError("Declaration digest must be 64 lowercase hexadecimal characters.")
        if not RUN_ID_PATTERN.fullmatch(self.run_id):
            raise ValueError("Run ID must be a lowercase slug.")

    @property
    def attempt_id(self) -> str:
        return f"gate-c/{self.declaration_digest}/{self.run_id}"


def write_canonical(path: Path, value: Any) -> dict[str, Any]:
    return _write_canonical(path, value)


def write_text(path: Path, value: str, artifact_type: str) -> dict[str, Any]:
    return _write_text(path, value, artifact_type)


def attempt_path(attempts_root: Path, identity: AttemptIdentity) -> Path:
    return attempts_root / identity.declaration_digest / identity.run_id


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{os.getpid()}.tmp"
    temporary.write_bytes(content)
    os.replace(temporary, path)


def write_current_pointer(
    current_path: Path,
    *,
    identity: AttemptIdentity,
    path: Path,
    started_at: str,
    status: str,
) -> None:
    pointer = {
        "schemaVersion": 1,
        "attemptId": identity.attempt_id,
        "declarationDigest": identity.declaration_digest,
        "runId": identity.run_id,
        "attemptPath": path.as_posix(),
        "startedAt": started_at,
        "status": status,
        "evidence": False,
    }
    _atomic_write(current_path, canonical_json_bytes(pointer))


def create_attempt(
    *,
    attempts_root: Path,
    current_path: Path,
    identity: AttemptIdentity,
    started_at: str,
) -> Path:
    path = attempt_path(attempts_root, identity)
    path.mkdir(parents=True, exist_ok=False)
    manifest = {
        "schemaVersion": 1,
        "attemptId": identity.attempt_id,
        "declarationDigest": identity.declaration_digest,
        "runId": identity.run_id,
        "startedAt": started_at,
        "phase": "running",
    }
    write_canonical(path / "attempt.json", manifest)
    write_current_pointer(
        current_path,
        identity=identity,
        path=path,
        started_at=started_at,
        status="running",
    )
    return path


def resolve_attempt(
    *,
    attempts_root: Path,
    identity: AttemptIdentity,
) -> Path:
    path = attempt_path(attempts_root, identity)
    manifest_path = path / "attempt.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Attempt manifest does not exist: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {
        "attemptId": identity.attempt_id,
        "declarationDigest": identity.declaration_digest,
        "runId": identity.run_id,
    }
    for field, value in expected.items():
        if manifest.get(field) != value:
            raise ValueError(f"Attempt manifest {field} does not match the explicit identity.")
    return path


def _output_entries(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    outputs = [
        candidate
        for candidate in path.rglob("*")
        if candidate.is_file() and candidate.name != "terminal.json"
    ]
    for output in sorted(outputs, key=lambda candidate: candidate.relative_to(path).as_posix()):
        content = output.read_bytes()
        entries.append(
            {
                "path": output.relative_to(path).as_posix(),
                "byteLength": len(content),
                "sha256": sha256_hex(content),
            }
        )
    return entries


def finalize_attempt(
    *,
    path: Path,
    identity: AttemptIdentity,
    status: str,
    terminal_fields: dict[str, Any],
) -> dict[str, Any]:
    terminal_path = path / "terminal.json"
    if terminal_path.exists():
        raise FileExistsError(f"Attempt is already terminal: {terminal_path}")
    manifest = json.loads((path / "attempt.json").read_text(encoding="utf-8"))
    terminal = {
        "schemaVersion": 1,
        "attemptId": identity.attempt_id,
        "declarationDigest": identity.declaration_digest,
        "runId": identity.run_id,
        "status": status,
        **terminal_fields,
        "outputs": _output_entries(path),
    }
    if manifest.get("attemptId") != identity.attempt_id:
        raise ValueError("Attempt start manifest does not match terminal identity.")
    _atomic_write(terminal_path, canonical_json_bytes(terminal))
    return terminal


def resolve_terminal_attempt(
    *,
    attempts_root: Path,
    identity: AttemptIdentity,
) -> tuple[Path, dict[str, Any]]:
    path = resolve_attempt(attempts_root=attempts_root, identity=identity)
    terminal_path = path / "terminal.json"
    if not terminal_path.is_file():
        raise FileNotFoundError(f"Attempt has no terminal manifest: {terminal_path}")
    terminal = json.loads(terminal_path.read_text(encoding="utf-8"))
    for field, value in {
        "attemptId": identity.attempt_id,
        "declarationDigest": identity.declaration_digest,
        "runId": identity.run_id,
    }.items():
        if terminal.get(field) != value:
            raise ValueError(f"Terminal manifest {field} does not match explicit identity.")
    if terminal.get("outputs") != _output_entries(path):
        raise ValueError("Terminal manifest does not match the exact attempt output set.")
    return path, terminal
