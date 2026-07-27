from __future__ import annotations

import io
import json
import tarfile
import zipfile
from pathlib import Path

import pytest
from palimpsest.contracts import sha256_hex
from palimpsest.solver.bundle import ArchiveLimits, inspect_archive, stage_solver_bundle

SOLVER = b'#!/bin/sh\nset -eu\ncp "$1/candidate.txt" "$2/reconstruction.txt"\n'


def _manifest(
    files: dict[str, bytes],
    *,
    executable: str = "solver.sh",
    producer_version: str = "palimpsest-solver-bundle/1",
    inputs: list[str] | None = None,
    outputs: list[str] | None = None,
) -> bytes:
    return json.dumps(
        {
            "schemaVersion": 1,
            "contractId": "solver-bundle-manifest",
            "producerVersion": producer_version,
            "executable": executable,
            "inputs": inputs or ["candidate.txt"],
            "outputs": outputs or ["reconstruction.txt"],
            "files": [
                {
                    "path": path,
                    "byteLength": len(content),
                    "sha256": sha256_hex(content),
                }
                for path, content in sorted(files.items())
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def _tar_bundle(path: Path, files: dict[str, bytes] | None = None) -> Path:
    files = files or {"solver.sh": SOLVER}
    entries = {**files, "solver-manifest.json": _manifest(files)}
    with tarfile.open(path, "w") as archive:
        for name, content in entries.items():
            item = tarfile.TarInfo(name)
            item.size = len(content)
            item.mode = 0o755 if name == "solver.sh" else 0o644
            archive.addfile(item, io.BytesIO(content))
    return path


def _raw_tar(path: Path, entries: list[tuple[tarfile.TarInfo, bytes]]) -> Path:
    with tarfile.open(path, "w") as archive:
        for item, content in entries:
            archive.addfile(item, io.BytesIO(content))
    return path


def _tar_item(name: str, content: bytes = b"x") -> tuple[tarfile.TarInfo, bytes]:
    item = tarfile.TarInfo(name)
    item.size = len(content)
    return item, content


def test_stages_only_declared_verified_payloads(tmp_path: Path) -> None:
    archive = _tar_bundle(
        tmp_path / "solver.tar", {"lib/helper.txt": b"helper\n", "solver.sh": SOLVER}
    )
    destination = tmp_path / "staged"

    staged = stage_solver_bundle(archive, destination)

    assert staged.executable == destination / "solver.sh"
    assert staged.bundle_sha256 == sha256_hex(archive.read_bytes())
    assert staged.manifest.inputs == ("candidate.txt",)
    assert staged.manifest.outputs == ("reconstruction.txt",)
    assert sorted(
        path.relative_to(destination).as_posix()
        for path in destination.rglob("*")
        if path.is_file()
    ) == ["lib/helper.txt", "solver.sh"]
    assert oct((destination / "solver.sh").stat().st_mode & 0o777) == "0o500"
    assert oct((destination / "lib/helper.txt").stat().st_mode & 0o777) == "0o400"


@pytest.mark.parametrize("name", ["../escape", "/absolute", "nested/../escape", "bad\\path"])
def test_rejects_escaping_paths_before_staging(tmp_path: Path, name: str) -> None:
    archive = _raw_tar(tmp_path / "escape.tar", [_tar_item(name)])
    with pytest.raises(ValueError, match="Unsafe archive path"):
        stage_solver_bundle(archive, tmp_path / "staged")
    assert not (tmp_path / "staged").exists()


@pytest.mark.parametrize("entry_type", [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE])
def test_rejects_links_and_devices(tmp_path: Path, entry_type: bytes) -> None:
    item = tarfile.TarInfo("solver.sh")
    item.type = entry_type
    item.linkname = "target"
    archive = _raw_tar(tmp_path / "special.tar", [(item, b"")])
    with pytest.raises(ValueError, match="not a regular file or directory"):
        inspect_archive(archive)


def test_rejects_sparse_entries(tmp_path: Path) -> None:
    item = tarfile.TarInfo("solver.sh")
    item.type = tarfile.GNUTYPE_SPARSE
    archive = _raw_tar(tmp_path / "sparse.tar", [(item, b"")])
    with pytest.raises(ValueError, match="Sparse archive"):
        inspect_archive(archive)


def test_rejects_duplicate_and_case_colliding_paths(tmp_path: Path) -> None:
    duplicate = _raw_tar(
        tmp_path / "duplicate.tar",
        [_tar_item("solver.sh", b"one"), _tar_item("solver.sh", b"two")],
    )
    with pytest.raises(ValueError, match="Duplicate archive path"):
        inspect_archive(duplicate)

    collision = _raw_tar(
        tmp_path / "collision.tar",
        [_tar_item("solver.sh", b"one"), _tar_item("SOLVER.SH", b"two")],
    )
    with pytest.raises(ValueError, match="Case-colliding archive path"):
        inspect_archive(collision)


def test_rejects_file_directory_prefix_collisions(tmp_path: Path) -> None:
    archive = _raw_tar(
        tmp_path / "prefix.tar",
        [_tar_item("solver.sh"), _tar_item("solver.sh/child")],
    )
    with pytest.raises(ValueError, match="collides with a child path"):
        inspect_archive(archive)


def test_rejects_entry_and_byte_bombs(tmp_path: Path) -> None:
    archive = _raw_tar(
        tmp_path / "bomb.tar",
        [_tar_item("one", b"12"), _tar_item("two", b"34")],
    )
    with pytest.raises(ValueError, match="entry-count"):
        inspect_archive(archive, ArchiveLimits(maximum_entries=1))
    with pytest.raises(ValueError, match="entry exceeds"):
        inspect_archive(archive, ArchiveLimits(maximum_entry_bytes=1))
    with pytest.raises(ValueError, match="total uncompressed"):
        inspect_archive(archive, ArchiveLimits(maximum_total_bytes=3))
    with pytest.raises(ValueError, match="compressed byte"):
        inspect_archive(archive, ArchiveLimits(maximum_archive_bytes=1))


def test_rejects_undeclared_missing_and_tampered_payloads(tmp_path: Path) -> None:
    files = {"solver.sh": SOLVER}
    manifest = _manifest(files)
    cases = {
        "undeclared": {
            "solver.sh": SOLVER,
            "extra.txt": b"extra",
            "solver-manifest.json": manifest,
        },
        "missing": {"solver-manifest.json": manifest},
        "tampered": {
            "solver.sh": b"tampered",
            "solver-manifest.json": manifest,
        },
    }
    for name, entries in cases.items():
        archive = _raw_tar(
            tmp_path / f"{name}.tar",
            [_tar_item(path, content) for path, content in entries.items()],
        )
        with pytest.raises(ValueError, match=r"exact payload|does not match"):
            stage_solver_bundle(archive, tmp_path / f"staged-{name}")


@pytest.mark.parametrize(
    ("manifest_kwargs", "message"),
    [
        ({"producer_version": "unknown/9"}, "producer version"),
        ({"executable": "missing.sh"}, "executable"),
        ({"inputs": ["oracle.txt"]}, "inputs"),
        ({"outputs": ["extra.txt"]}, "outputs"),
    ],
)
def test_rejects_invalid_manifest_declarations(
    tmp_path: Path, manifest_kwargs: dict[str, object], message: str
) -> None:
    files = {"solver.sh": SOLVER}
    entries = {
        "solver.sh": SOLVER,
        "solver-manifest.json": _manifest(files, **manifest_kwargs),
    }
    archive = _raw_tar(
        tmp_path / f"{message.replace(' ', '-')}.tar",
        [_tar_item(path, content) for path, content in entries.items()],
    )
    with pytest.raises(ValueError, match=message):
        stage_solver_bundle(archive, tmp_path / "staged")


def test_zip_bundles_obey_the_same_validation_and_staging_contract(tmp_path: Path) -> None:
    archive = tmp_path / "solver.zip"
    files = {"solver.sh": SOLVER}
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("solver.sh", SOLVER)
        output.writestr("solver-manifest.json", _manifest(files))

    staged = stage_solver_bundle(archive, tmp_path / "staged")

    assert staged.executable.read_bytes() == SOLVER
