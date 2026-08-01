from __future__ import annotations

import math
import re
from pathlib import Path, PurePosixPath, PureWindowsPath

_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_IDENTIFIER = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _record(
    value: object,
    name: str,
    fields: frozenset[str] | None = None,
) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{name} must be an object.")
    result = {key: item for key, item in value.items() if isinstance(key, str)}
    if fields is not None:
        missing = fields - result.keys()
        extra = result.keys() - fields
        if missing:
            raise ValueError(f"{name} {sorted(missing)[0]} is required.")
        if extra:
            raise ValueError(f"{name} contains unknown field {sorted(extra)[0]}.")
    return result


def _integer(value: object, name: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or abs(value) > 9_007_199_254_740_991:
        raise ValueError(f"{name} must be an integer of at least {minimum}.")
    return value


def _safe_integer(value: object, name: str) -> int:
    if type(value) is not int or abs(value) > 9_007_199_254_740_991:
        raise ValueError(f"{name} must be an interoperable integer.")
    return value


def _ratio(value: object, name: str, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number between {minimum} and 1.")
    result = float(value)
    if not math.isfinite(result) or result < minimum or result > 1.0:
        raise ValueError(f"{name} must be a finite number between {minimum} and 1.")
    return result


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string.")
    return value


def _identifier(value: object, name: str) -> str:
    result = _string(value, name)
    if _IDENTIFIER.fullmatch(result) is None:
        raise ValueError(f"{name} must be a canonical identifier.")
    return result


def _is_identifier(value: object) -> bool:
    return isinstance(value, str) and _IDENTIFIER.fullmatch(value) is not None


def _digest(value: object, name: str) -> str:
    result = _string(value, name)
    if _DIGEST.fullmatch(result) is None:
        raise ValueError(f"{name} must be a lowercase SHA-256 digest.")
    return result


def _prefixed_digest(value: object, prefix: str, name: str) -> str:
    result = _string(value, name)
    if not result.startswith(prefix) or _DIGEST.fullmatch(result[len(prefix) :]) is None:
        raise ValueError(f"{name} must contain a lowercase SHA-256 digest.")
    return result


def _relative_path(value: object, name: str) -> Path:
    source = _string(value, name)
    posix = PurePosixPath(source)
    windows = PureWindowsPath(source)
    parts = re.split(r"[\\/]", source)
    if (
        "\0" in source
        or posix.is_absolute()
        or windows.is_absolute()
        or bool(windows.drive)
        or any(part in {"", ".", ".."} for part in parts)
    ):
        raise ValueError(f"{name} must be a safe relative path.")
    return Path(source)


def _array(value: object, name: str, *, allow_empty: bool = False) -> list[object]:
    if not isinstance(value, list) or (not allow_empty and not value):
        qualifier = "" if allow_empty else " non-empty"
        raise ValueError(f"{name} must be a{qualifier} array.")
    return value


def _strings(value: object, name: str, *, allow_empty: bool = False) -> tuple[str, ...]:
    items = _array(value, name, allow_empty=allow_empty)
    return tuple(_string(item, f"{name}[{index}]") for index, item in enumerate(items))
