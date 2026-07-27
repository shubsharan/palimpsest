from __future__ import annotations

import argparse
import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from jsonschema import ValidationError

from .archive import canonical_archive_bytes
from .canonical_json import (
    ContractInputError,
    canonical_json_bytes,
    child_pointer,
    parse_json_strict,
)
from .digest import sha256_hex
from .gate_report_core import predeclaration_digest
from .schemas import CONTRACT_SCHEMAS, contract_validator


@dataclass(frozen=True)
class ValidationVerdict:
    accepted: bool
    reason: str | None
    pointer: str | None
    value: Any
    canonical_base64: str | None
    sha256: str | None


def _reject(reason: str, pointer: str) -> ValidationVerdict:
    return ValidationVerdict(False, reason, pointer, None, None, None)


def _pointer(error: ValidationError) -> str:
    pointer = "".join(child_pointer("", part) for part in error.absolute_path)
    if error.validator == "required":
        missing = error.message.split("'")[1]
        return child_pointer(pointer, missing)
    if error.validator in {"additionalProperties", "unevaluatedProperties"}:
        unknown = error.message.split("'")[1]
        return child_pointer(pointer, unknown)
    return pointer


def _reason(error: ValidationError, pointer: str) -> str:
    if pointer == "/schemaVersion":
        return "schema_version"
    if error.validator in {"additionalProperties", "unevaluatedProperties"}:
        return "unknown_field"
    if error.validator == "required":
        return "required"
    if error.validator == "type":
        return "type"
    if error.validator in {"enum", "const"}:
        return "enum"
    if error.validator in {"minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"}:
        return "range"
    return "format"


def validate_value(contract_id: str, value: Any) -> ValidationVerdict:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        return _reject("schema_version", "/schemaVersion")

    if contract_id == "canonical-archive":
        try:
            canonical_archive_bytes(value)
        except ContractInputError as error:
            return _reject(error.reason, error.pointer)

    errors = []
    for error in contract_validator(contract_id, value).iter_errors(value):
        pointer = _pointer(error)
        errors.append((pointer, _reason(error, pointer)))
    if errors:
        pointer, reason = sorted(errors)[0]
        return _reject(reason, pointer)

    if contract_id == "gate-report" and value.get("predeclarationDigest") != predeclaration_digest(
        value
    ):
        return _reject("digest", "/predeclarationDigest")

    canonical = canonical_json_bytes(value)
    return ValidationVerdict(
        True,
        None,
        None,
        value,
        base64.b64encode(canonical).decode("ascii"),
        sha256_hex(canonical),
    )


def validate_fixture(contract_id: str, raw: str) -> ValidationVerdict:
    if contract_id not in CONTRACT_SCHEMAS:
        return _reject("enum", "/contractId")
    try:
        value = parse_json_strict(raw)
    except ContractInputError as error:
        return _reject(error.reason, error.pointer)
    return validate_value(contract_id, value)


def build_fixture_verdicts(fixtures_root: Path) -> list[dict[str, Any]]:
    manifest = json.loads((fixtures_root / "manifest.json").read_text(encoding="utf-8"))
    verdicts = []
    for fixture in manifest["fixtures"]:
        raw = (fixtures_root / fixture["inputPath"]).read_text(encoding="utf-8")
        verdict = validate_fixture(fixture["contractId"], raw)
        archive_base64 = None
        archive_sha256 = None
        if verdict.accepted and fixture["contractId"] == "canonical-archive":
            archive = canonical_archive_bytes(verdict.value)
            archive_base64 = base64.b64encode(archive).decode("ascii")
            archive_sha256 = sha256_hex(archive)
        verdicts.append(
            {
                "accepted": verdict.accepted,
                "archiveBase64": archive_base64,
                "archiveSha256": archive_sha256,
                "canonicalBase64": verdict.canonical_base64,
                "fixtureId": fixture["fixtureId"],
                "pointer": verdict.pointer,
                "reason": verdict.reason,
                "sha256": verdict.sha256,
            }
        )
    return verdicts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture-verdicts", action="store_true")
    parser.add_argument("--values-file", type=Path)
    args = parser.parse_args()
    if args.values_file is not None:
        cases = json.loads(args.values_file.read_text(encoding="utf-8"))
        print(
            json.dumps(
                [
                    {
                        "accepted": verdict.accepted,
                        "pointer": verdict.pointer,
                        "reason": verdict.reason,
                        "sha256": verdict.sha256,
                    }
                    for case in cases
                    for verdict in [validate_value(case["contractId"], case["value"])]
                ],
                separators=(",", ":"),
            )
        )
        return
    if not args.fixture_verdicts:
        parser.error("--fixture-verdicts or --values-file is required")
    fixtures_root = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "fixtures"
    print(
        json.dumps(
            build_fixture_verdicts(fixtures_root),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
