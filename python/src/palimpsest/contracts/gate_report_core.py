from __future__ import annotations

from typing import Any

from .canonical_json import canonical_json_bytes
from .digest import sha256_hex

DECLARATION_FIELDS = (
    "schemaVersion",
    "gateId",
    "question",
    "frozenInputs",
    "thresholds",
    "criteria",
)


def predeclaration_projection(report: dict[str, Any]) -> dict[str, Any]:
    missing = [field for field in DECLARATION_FIELDS if field not in report]
    if missing:
        raise ValueError(f"Gate report is missing predeclaration fields: {', '.join(missing)}")
    return {field: report[field] for field in DECLARATION_FIELDS}


def predeclaration_digest(report: dict[str, Any]) -> str:
    return sha256_hex(canonical_json_bytes(predeclaration_projection(report)))
