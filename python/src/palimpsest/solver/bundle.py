from __future__ import annotations

import io
import json
import os
import shutil
import stat
import tarfile
import tempfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from palimpsest.contracts import sha256_hex

MANIFEST_PATH = "solver-manifest.json"
SUPPORTED_PRODUCER_VERSIONS = ("palimpsest-solver-bundle/1",)
EXPECTED_INPUTS = ("candidate.txt",)
EXPECTED_OUTPUTS = ("reconstruction.txt",)


@dataclass(frozen=True)
class ArchiveLimits:
    maximum_entries: int = 1_000
    maximum_archive_bytes: int = 64 * 1024 * 1024
    maximum_total_bytes: int = 32 * 1024 * 1024
    maximum_entry_bytes: int = 8 * 1024 * 1024
    maximum_path_bytes: int = 240


@dataclass(frozen=True)
class SolverBundleManifest:
    producer_version: str
    executable: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]
    files: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class StagedSolver:
    root: Path
    executable: Path
    bundle_sha256: str
    manifest: SolverBundleManifest


@dataclass(frozen=True)
class _ArchiveEntry:
    path: str
    source_name: str
    size: int
    kind: str


@dataclass(frozen=True)
class _ArchiveInventory:
    archive_format: str
    entries: tuple[_ArchiveEntry, ...]


def _safe_path(name: str, *, directory: bool, limits: ArchiveLimits) -> str:
    if directory:
        if name.endswith("//"):
            raise ValueError(f"Unsafe archive path: {name}")
        name = name.removesuffix("/")
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or "\0" in name
        or unicodedata.normalize("NFC", name) != name
    ):
        raise ValueError(f"Unsafe archive path: {name}")
    path = PurePosixPath(name)
    if any(part in {"", ".", ".."} for part in path.parts) or path.as_posix() != name:
        raise ValueError(f"Unsafe archive path: {name}")
    if len(name.encode("utf-8")) > limits.maximum_path_bytes:
        raise ValueError(f"Archive path exceeds the byte limit: {name}")
    return name


def _zip_entries(data: bytes, limits: ArchiveLimits) -> list[_ArchiveEntry] | None:
    source = io.BytesIO(data)
    if not zipfile.is_zipfile(source):
        return None
    entries = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for item in archive.infolist():
            if item.flag_bits & 0x1:
                raise ValueError(f"Encrypted archive entries are unsupported: {item.filename}")
            mode = (item.external_attr >> 16) & 0xFFFF
            file_type = stat.S_IFMT(mode)
            if item.is_dir():
                kind = "directory"
            elif file_type not in {0, stat.S_IFREG}:
                raise ValueError(
                    f"Archive entry is not a regular file or directory: {item.filename}"
                )
            else:
                kind = "file"
            path = _safe_path(item.filename, directory=kind == "directory", limits=limits)
            entries.append(_ArchiveEntry(path, item.filename, item.file_size, kind))
    return entries


def _tar_entries(data: bytes, limits: ArchiveLimits) -> list[_ArchiveEntry] | None:
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
            members = archive.getmembers()
    except tarfile.ReadError:
        return None
    entries = []
    for item in members:
        if item.type == tarfile.GNUTYPE_SPARSE or item.sparse is not None:
            raise ValueError(f"Sparse archive entries are unsupported: {item.name}")
        if item.isdir():
            kind = "directory"
        elif item.isfile():
            kind = "file"
        else:
            raise ValueError(f"Archive entry is not a regular file or directory: {item.name}")
        path = _safe_path(item.name, directory=kind == "directory", limits=limits)
        entries.append(_ArchiveEntry(path, item.name, item.size, kind))
    return entries


def _inspect_archive_bytes(data: bytes, limits: ArchiveLimits) -> _ArchiveInventory:
    if len(data) > limits.maximum_archive_bytes:
        raise ValueError("Solver archive exceeds the compressed byte limit.")
    entries = _zip_entries(data, limits)
    archive_format = "zip"
    if entries is None:
        entries = _tar_entries(data, limits)
        archive_format = "tar"
    if entries is None:
        raise ValueError("Solver bundle is neither a ZIP nor a tar archive.")
    if len(entries) > limits.maximum_entries:
        raise ValueError("Solver archive exceeds the entry-count limit.")

    seen: set[str] = set()
    collision_keys: set[str] = set()
    total = 0
    for entry in entries:
        collision = entry.path.casefold()
        if entry.path in seen:
            raise ValueError(f"Duplicate archive path: {entry.path}")
        if collision in collision_keys:
            raise ValueError(f"Case-colliding archive path: {entry.path}")
        if entry.kind == "directory" and entry.size != 0:
            raise ValueError(f"Archive directory has a nonzero size: {entry.path}")
        if entry.size > limits.maximum_entry_bytes:
            raise ValueError(f"Archive entry exceeds the byte limit: {entry.path}")
        seen.add(entry.path)
        collision_keys.add(collision)
        if entry.kind == "file":
            total += entry.size
    if total > limits.maximum_total_bytes:
        raise ValueError("Solver archive exceeds the total uncompressed byte limit.")

    files = [entry.path for entry in entries if entry.kind == "file"]
    directories = [entry.path for entry in entries if entry.kind == "directory"]
    for file_path in files:
        if any(
            other != file_path and other.startswith(f"{file_path}/")
            for other in (*files, *directories)
        ):
            raise ValueError(f"Archive file collides with a child path: {file_path}")
    return _ArchiveInventory(archive_format, tuple(entries))


def inspect_archive(path: Path, limits: ArchiveLimits | None = None) -> tuple[str, ...]:
    limits = limits or ArchiveLimits()
    inventory = _inspect_archive_bytes(path.read_bytes(), limits)
    return tuple(sorted(entry.path for entry in inventory.entries))


def _read_entry(data: bytes, inventory: _ArchiveInventory, entry: _ArchiveEntry) -> bytes:
    if inventory.archive_format == "zip":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            content = archive.read(entry.source_name)
    else:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
            member = archive.getmember(entry.source_name)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"Archive file cannot be read: {entry.path}")
            content = stream.read()
    if len(content) != entry.size:
        raise ValueError(f"Archive entry size changed while reading: {entry.path}")
    return content


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON field: {key}")
        result[key] = value
    return result


def _string_list(value: Any, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError(f"Solver manifest field {field} must be an array of strings.")
    values = tuple(value)
    if len(set(values)) != len(values):
        raise ValueError(f"Solver manifest field {field} contains duplicates.")
    return values


def _parse_manifest(
    content: bytes,
    inventory: _ArchiveInventory,
    payloads: dict[str, bytes],
    *,
    allowed_producer_versions: tuple[str, ...],
    expected_inputs: tuple[str, ...],
    expected_outputs: tuple[str, ...],
) -> SolverBundleManifest:
    try:
        value = json.loads(content.decode("utf-8"), object_pairs_hook=_strict_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Solver manifest is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise ValueError("Solver manifest must be a JSON object.")
    expected_fields = {
        "schemaVersion",
        "contractId",
        "producerVersion",
        "executable",
        "inputs",
        "outputs",
        "files",
    }
    if set(value) != expected_fields:
        raise ValueError("Solver manifest fields do not match the version 1 contract.")
    if value["schemaVersion"] != 1 or value["contractId"] != "solver-bundle-manifest":
        raise ValueError("Solver manifest identity is unsupported.")
    producer_version = value["producerVersion"]
    if not isinstance(producer_version, str) or producer_version not in allowed_producer_versions:
        raise ValueError("Solver manifest producer version is not allowed.")
    executable = value["executable"]
    if not isinstance(executable, str):
        raise ValueError("Solver manifest executable must be a path.")
    executable = _safe_path(executable, directory=False, limits=ArchiveLimits())
    inputs = _string_list(value["inputs"], "inputs")
    outputs = _string_list(value["outputs"], "outputs")
    if inputs != expected_inputs:
        raise ValueError(f"Solver manifest inputs must be exactly {expected_inputs}.")
    if outputs != expected_outputs:
        raise ValueError(f"Solver manifest outputs must be exactly {expected_outputs}.")

    files_value = value["files"]
    if not isinstance(files_value, list):
        raise ValueError("Solver manifest files must be an array.")
    declared: list[dict[str, Any]] = []
    for file_value in files_value:
        if not isinstance(file_value, dict) or set(file_value) != {"path", "byteLength", "sha256"}:
            raise ValueError("Solver manifest file entries do not match the version 1 contract.")
        path = file_value["path"]
        byte_length = file_value["byteLength"]
        digest = file_value["sha256"]
        if not isinstance(path, str):
            raise ValueError("Solver manifest file path must be a string.")
        path = _safe_path(path, directory=False, limits=ArchiveLimits())
        if (
            not isinstance(byte_length, int)
            or isinstance(byte_length, bool)
            or byte_length < 0
            or not isinstance(digest, str)
            or len(digest) != 64
            or any(character not in "0123456789abcdef" for character in digest)
        ):
            raise ValueError(f"Solver manifest file metadata is invalid: {path}")
        declared.append({"path": path, "byteLength": byte_length, "sha256": digest})
    if declared != sorted(declared, key=lambda item: item["path"]):
        raise ValueError("Solver manifest files must be sorted by path.")
    declared_paths = [item["path"] for item in declared]
    if len(set(declared_paths)) != len(declared_paths):
        raise ValueError("Solver manifest contains duplicate file declarations.")

    archive_files = sorted(
        entry.path
        for entry in inventory.entries
        if entry.kind == "file" and entry.path != MANIFEST_PATH
    )
    if declared_paths != archive_files:
        raise ValueError("Solver manifest does not declare the archive's exact payload file set.")
    if executable not in declared_paths:
        raise ValueError("Solver manifest executable is not a declared payload file.")
    for declaration in declared:
        payload = payloads[declaration["path"]]
        if (
            len(payload) != declaration["byteLength"]
            or sha256_hex(payload) != declaration["sha256"]
        ):
            raise ValueError(
                f"Solver payload does not match its declaration: {declaration['path']}"
            )
    return SolverBundleManifest(
        producer_version=producer_version,
        executable=executable,
        inputs=inputs,
        outputs=outputs,
        files=tuple(declared),
    )


def stage_solver_bundle(
    archive: Path,
    destination: Path,
    *,
    limits: ArchiveLimits | None = None,
    allowed_producer_versions: tuple[str, ...] = SUPPORTED_PRODUCER_VERSIONS,
    expected_inputs: tuple[str, ...] = EXPECTED_INPUTS,
    expected_outputs: tuple[str, ...] = EXPECTED_OUTPUTS,
) -> StagedSolver:
    limits = limits or ArchiveLimits()
    if destination.exists():
        raise FileExistsError(f"Solver staging destination already exists: {destination}")
    data = archive.read_bytes()
    inventory = _inspect_archive_bytes(data, limits)
    file_entries = {entry.path: entry for entry in inventory.entries if entry.kind == "file"}
    manifest_entry = file_entries.get(MANIFEST_PATH)
    if manifest_entry is None:
        raise ValueError(f"Solver archive is missing {MANIFEST_PATH}.")
    payloads = {
        path: _read_entry(data, inventory, entry)
        for path, entry in file_entries.items()
        if path != MANIFEST_PATH
    }
    manifest = _parse_manifest(
        _read_entry(data, inventory, manifest_entry),
        inventory,
        payloads,
        allowed_producer_versions=allowed_producer_versions,
        expected_inputs=expected_inputs,
        expected_outputs=expected_outputs,
    )

    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".solver-", dir=destination.parent))
    try:
        for declaration in manifest.files:
            path = staging.joinpath(*PurePosixPath(declaration["path"]).parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payloads[declaration["path"]])
            path.chmod(0o500 if declaration["path"] == manifest.executable else 0o400)
        for directory in sorted(
            (path for path in staging.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        ):
            directory.chmod(0o500)
        os.replace(staging, destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return StagedSolver(
        root=destination,
        executable=destination.joinpath(*PurePosixPath(manifest.executable).parts),
        bundle_sha256=sha256_hex(data),
        manifest=manifest,
    )
