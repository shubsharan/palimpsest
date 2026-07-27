from __future__ import annotations

import json
from pathlib import Path

from palimpsest.instance_pipeline.bundle import build_bundle

ROOT = Path(__file__).resolve().parents[3]


def test_public_projection_excludes_source_oracle_and_keys(tmp_path: Path) -> None:
    destination = tmp_path / "bundle"
    build_bundle(ROOT, destination)
    public = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (destination / "public").rglob("*")
        if path.is_file()
    ).casefold()
    assert "middlemarch" not in public
    assert "stationary-key" not in public
    assert "prepared-plaintext" not in public
    manifest = json.loads((destination / "public/manifest.json").read_text())
    assert manifest["contractId"] == "public-instance-manifest"


def test_each_private_projection_contains_only_its_agent_shard(tmp_path: Path) -> None:
    destination = tmp_path / "bundle"
    build_bundle(ROOT, destination)
    for agent_number in range(1, 4):
        agent = f"agent-{agent_number}"
        private_files = [path.as_posix() for path in (destination / "private" / agent).rglob("*")]
        assert private_files
        assert all(f"/{agent}/" in path for path in private_files)
