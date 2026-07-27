from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex


def artifact_reference(path: Path, artifact_type: str) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def promote_file(path: Path, artifact_type: str) -> dict[str, Any]:
    content = path.read_bytes()
    reference = {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }
    root = Path("artifacts/gate-b/by-digest")
    root.mkdir(parents=True, exist_ok=True)
    destination = root / reference["sha256"]
    if destination.exists():
        if destination.read_bytes() != content:
            raise RuntimeError(f"Digest store collision at {destination}.")
    else:
        staging = root / f".{reference['sha256']}.{os.getpid()}.tmp"
        staging.write_bytes(content)
        try:
            staging.replace(destination)
        except OSError:
            if not destination.exists() or destination.read_bytes() != content:
                raise
            staging.unlink(missing_ok=True)
    return reference


def write_canonical(path: Path, value: Any) -> dict[str, Any]:
    content = canonical_json_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {
        "artifactType": path.stem.replace("_", "-"),
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def write_text(path: Path, value: str, artifact_type: str) -> dict[str, Any]:
    content = value.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }
