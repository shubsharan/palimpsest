from __future__ import annotations

import stat
import tarfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


@dataclass(frozen=True)
class ArchiveLimits:
    maximum_entries: int = 1_000
    maximum_total_bytes: int = 32 * 1024 * 1024
    maximum_entry_bytes: int = 8 * 1024 * 1024


def _safe_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ValueError(f"Unsafe archive path: {name}")
    return path


def inspect_archive(path: Path, limits: ArchiveLimits | None = None) -> tuple[str, ...]:
    limits = limits or ArchiveLimits()
    entries: list[tuple[str, int, bool]] = []
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for item in archive.infolist():
                mode = item.external_attr >> 16
                entries.append(
                    (
                        item.filename,
                        item.file_size,
                        item.is_dir() or stat.S_ISREG(mode) or mode == 0,
                    )
                )
    elif tarfile.is_tarfile(path):
        with tarfile.open(path) as archive:
            for item in archive.getmembers():
                entries.append((item.name, item.size, item.isfile() or item.isdir()))
    else:
        raise ValueError("Solver bundle is neither a ZIP nor a tar archive.")

    if len(entries) > limits.maximum_entries:
        raise ValueError("Solver archive exceeds the entry-count limit.")
    seen: set[str] = set()
    collision_keys: set[str] = set()
    total = 0
    for name, size, regular in entries:
        normalized = _safe_path(name).as_posix()
        collision = normalized.casefold()
        if normalized in seen:
            raise ValueError(f"Duplicate archive path: {normalized}")
        if collision in collision_keys:
            raise ValueError(f"Case-colliding archive path: {normalized}")
        if not regular:
            raise ValueError(f"Archive entry is not a regular file or directory: {normalized}")
        if size > limits.maximum_entry_bytes:
            raise ValueError(f"Archive entry exceeds the byte limit: {normalized}")
        seen.add(normalized)
        collision_keys.add(collision)
        total += size
    if total > limits.maximum_total_bytes:
        raise ValueError("Solver archive exceeds the total uncompressed byte limit.")
    return tuple(sorted(seen))
