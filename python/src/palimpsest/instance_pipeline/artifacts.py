from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex


def artifact_reference(content: bytes, artifact_type: str) -> dict[str, Any]:
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def write_bytes(path: Path, content: bytes) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {
        "path": path.as_posix(),
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def write_canonical(path: Path, value: Any) -> dict[str, Any]:
    return write_bytes(path, canonical_json_bytes(value))


def exact_output_entries(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for candidate in sorted(
        (path for path in root.rglob("*") if path.is_file()),
        key=lambda path: path.relative_to(root).as_posix(),
    ):
        content = candidate.read_bytes()
        entries.append(
            {
                "path": candidate.relative_to(root).as_posix(),
                "byteLength": len(content),
                "sha256": sha256_hex(content),
            }
        )
    return entries


def promote_fresh(staging: Path, destination: Path) -> None:
    if destination.exists():
        raise FileExistsError(f"Destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(staging, destination)
