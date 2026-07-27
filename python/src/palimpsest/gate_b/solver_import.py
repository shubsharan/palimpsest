from __future__ import annotations

import argparse
import json
import os
import uuid
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, validate_value
from palimpsest.generation.text import word_tokens

from .artifacts import promote_file, write_canonical

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
HUMAN_MANIFEST_FIELDS = {
    "schemaVersion",
    "instanceId",
    "condition",
    "solverIdentity",
    "checkpoints",
}
AGENT_MANIFEST_FIELDS = HUMAN_MANIFEST_FIELDS | {
    "predeclarationDigest",
    "runId",
    "attemptId",
    "producerVersion",
    "terminalStatus",
}
BASE_CHECKPOINT_FIELDS = {
    "sequence",
    "trustedElapsedSeconds",
    "reconstructionPath",
    "mappingPath",
    "toolEventsPath",
    "identificationClaimsPath",
    "usagePath",
}
AGENT_CHECKPOINT_FIELDS = BASE_CHECKPOINT_FIELDS | {
    "predeclarationDigest",
    "runId",
}


def _atomic_write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(canonical_json_bytes(value))
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _load_manifest(bundle: Path) -> dict[str, Any]:
    manifest_path = bundle / "manifest.json"
    if not manifest_path.is_file():
        legacy_files = list(bundle.glob("mapping-*.json")) + list(bundle.glob("stream-*.jsonl"))
        if legacy_files:
            raise ValueError("Flat frontier-agent directories are invalid and cannot be imported.")
        raise ValueError(f"Selected attempt has no manifest.json: {bundle}")
    value = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Solver manifest must be a JSON object.")
    return value


def _validate_agent_identity(
    bundle: Path,
    manifest: dict[str, Any],
    *,
    expected_predeclaration_digest: str | None,
) -> None:
    if set(manifest) != AGENT_MANIFEST_FIELDS:
        raise ValueError("Frontier-agent manifest has missing or undeclared identity fields.")
    if manifest["schemaVersion"] != 2:
        raise ValueError("Legacy frontier-agent manifests cannot be imported as isolated attempts.")
    identity_fields = (
        "instanceId",
        "predeclarationDigest",
        "runId",
        "attemptId",
        "producerVersion",
    )
    if not all(isinstance(manifest[field], str) and manifest[field] for field in identity_fields):
        raise ValueError("Frontier-agent manifest identity fields must be nonempty strings.")
    if manifest["terminalStatus"] != "completed":
        raise ValueError("Only a completed frontier-agent attempt can be imported.")
    if expected_predeclaration_digest is not None and (
        manifest["predeclarationDigest"] != expected_predeclaration_digest
    ):
        raise ValueError("Selected attempt does not match the current predeclaration digest.")
    expected = (
        bundle.parent.parent.parent
        / manifest["instanceId"]
        / manifest["predeclarationDigest"]
        / manifest["runId"]
    )
    if bundle.resolve() != expected.resolve() or bundle.parent.parent.parent.name != "agent":
        raise ValueError("Frontier-agent manifest identity does not match its attempt path.")
    status = json.loads((bundle / "status.json").read_text(encoding="utf-8"))
    status_attempt_path = status.get("attemptPath")
    if not isinstance(status_attempt_path, str):
        raise ValueError("Attempt status has no attemptPath.")
    resolved_status_path = Path(status_attempt_path)
    if not resolved_status_path.is_absolute():
        resolved_status_path = ROOT / resolved_status_path
    if resolved_status_path.resolve() != bundle.resolve():
        raise ValueError("Attempt status path does not match the selected attempt.")
    for field, expected_value in (
        ("schemaVersion", 2),
        ("instanceId", manifest["instanceId"]),
        ("predeclarationDigest", manifest["predeclarationDigest"]),
        ("runId", manifest["runId"]),
        ("attemptId", manifest["attemptId"]),
        ("producerVersion", manifest["producerVersion"]),
        ("status", manifest["terminalStatus"]),
    ):
        if status.get(field) != expected_value:
            raise ValueError(f"Attempt status and manifest disagree on {field}.")


def _safe_file(bundle: Path, relative: str) -> Path:
    path = bundle / relative
    resolved = path.resolve()
    if resolved.parent != bundle.resolve() or not path.is_file():
        raise ValueError(f"Checkpoint path must name a direct regular bundle file: {relative}")
    return path


def import_checkpoint_bundle(
    bundle: Path,
    *,
    expected_predeclaration_digest: str | None = None,
) -> list[dict[str, Any]]:
    manifest = _load_manifest(bundle)
    if manifest["condition"] not in {"frontier-agent-tools", "human-tools"}:
        raise ValueError("Solver condition is unsupported.")
    is_agent = manifest["condition"] == "frontier-agent-tools"
    if is_agent:
        _validate_agent_identity(
            bundle,
            manifest,
            expected_predeclaration_digest=expected_predeclaration_digest,
        )
    elif set(manifest) != HUMAN_MANIFEST_FIELDS or manifest["schemaVersion"] != 1:
        raise ValueError("Human solver manifest has missing or undeclared fields.")
    checkpoints = manifest["checkpoints"]
    if not isinstance(checkpoints, list) or not checkpoints:
        raise ValueError("Solver manifest requires at least one checkpoint.")
    records = []
    previous_elapsed = -1.0
    for expected_sequence, checkpoint in enumerate(checkpoints):
        expected_fields = AGENT_CHECKPOINT_FIELDS if is_agent else BASE_CHECKPOINT_FIELDS
        if set(checkpoint) != expected_fields:
            raise ValueError("Solver checkpoint has missing or undeclared fields.")
        if is_agent and (
            checkpoint["predeclarationDigest"] != manifest["predeclarationDigest"]
            or checkpoint["runId"] != manifest["runId"]
        ):
            raise ValueError(
                "Checkpoint predeclaration digest or run ID differs from the selected attempt."
            )
        if checkpoint["sequence"] != expected_sequence:
            raise ValueError("Solver checkpoint sequence is not contiguous.")
        elapsed = checkpoint["trustedElapsedSeconds"]
        if not isinstance(elapsed, int | float) or elapsed <= previous_elapsed:
            raise ValueError("Trusted elapsed work must increase strictly.")
        previous_elapsed = float(elapsed)
        reconstruction_path = _safe_file(bundle, checkpoint["reconstructionPath"])
        if len(word_tokens(reconstruction_path.read_text(encoding="utf-8"))) != 20_000:
            raise ValueError("Solver reconstruction must contain exactly 20,000 word tokens.")
        mapping_path = _safe_file(bundle, checkpoint["mappingPath"])
        tool_path = _safe_file(bundle, checkpoint["toolEventsPath"])
        claims_path = _safe_file(bundle, checkpoint["identificationClaimsPath"])
        usage_path = _safe_file(bundle, checkpoint["usagePath"])
        for path in (mapping_path, tool_path, claims_path, usage_path):
            json.loads(path.read_text(encoding="utf-8"))
        record = {
            "schemaVersion": 1,
            "contractId": "gate-b-solver-checkpoint",
            "checkpointId": (
                f"{manifest['instanceId']}-{manifest['condition']}-{expected_sequence}"
            ),
            "instanceId": manifest["instanceId"],
            "condition": manifest["condition"],
            "sequence": expected_sequence,
            "trustedElapsedSeconds": float(elapsed),
            "reconstruction": promote_file(
                reconstruction_path,
                "solver-reconstruction",
            ),
            "mapping": promote_file(mapping_path, "solver-mapping"),
            "toolEvents": promote_file(tool_path, "solver-tool-events"),
            "identificationClaims": promote_file(
                claims_path,
                "solver-identification-claims",
            ),
            "usage": promote_file(usage_path, "solver-resource-usage"),
        }
        verdict = validate_value("gate-b-solver-checkpoint", record)
        if not verdict.accepted:
            raise ValueError(
                f"gate-b-solver-checkpoint rejected: {verdict.reason} at {verdict.pointer}"
            )
        records.append(record)
    return records


def promote_checkpoint_bundle(
    bundle: Path,
    output_root: Path,
    *,
    expected_predeclaration_digest: str | None = None,
) -> dict[str, Any]:
    manifest = _load_manifest(bundle)
    records = import_checkpoint_bundle(
        bundle,
        expected_predeclaration_digest=expected_predeclaration_digest,
    )
    output_root.mkdir(parents=True, exist_ok=False)
    references = [
        write_canonical(output_root / f"checkpoint-{record['sequence']}.json", record)
        for record in records
    ]
    result = {
        "schemaVersion": 2 if manifest["condition"] == "frontier-agent-tools" else 1,
        "instanceId": manifest["instanceId"],
        "condition": manifest["condition"],
        "checkpointCount": len(records),
        "checkpoints": references,
    }
    if manifest["condition"] == "frontier-agent-tools":
        result.update(
            {
                "predeclarationDigest": manifest["predeclarationDigest"],
                "runId": manifest["runId"],
                "attemptId": manifest["attemptId"],
                "producerVersion": manifest["producerVersion"],
                "terminalStatus": manifest["terminalStatus"],
            }
        )
    write_canonical(output_root / "manifest.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--expected-condition",
        choices=("frontier-agent-tools", "human-tools"),
    )
    args = parser.parse_args()
    manifest = _load_manifest(args.input)
    if args.expected_condition and manifest.get("condition") != args.expected_condition:
        parser.error(
            f"bundle condition {manifest.get('condition')!r} does not match "
            f"{args.expected_condition!r}"
        )
    condition_roots = {
        "frontier-agent-tools": "agent",
        "human-tools": "human",
    }
    condition = manifest.get("condition")
    instance_id = manifest.get("instanceId")
    if condition not in condition_roots or not isinstance(instance_id, str):
        parser.error("bundle manifest has no supported condition and instanceId")
    predeclaration = json.loads((GATE_B_ROOT / "predeclaration.json").read_text(encoding="utf-8"))
    expected_digest = predeclaration["predeclarationDigest"]
    if condition == "frontier-agent-tools":
        _validate_agent_identity(
            args.input,
            manifest,
            expected_predeclaration_digest=expected_digest,
        )
        default_output = (
            GATE_B_ROOT
            / "attempts"
            / "agent"
            / instance_id
            / manifest["predeclarationDigest"]
            / manifest["runId"]
        )
    else:
        default_output = GATE_B_ROOT / "attempts" / "human" / instance_id
    output = args.output or default_output
    result = promote_checkpoint_bundle(
        args.input,
        output,
        expected_predeclaration_digest=(
            expected_digest if condition == "frontier-agent-tools" else None
        ),
    )
    if condition == "frontier-agent-tools":
        selection = {
            key: result[key]
            for key in (
                "schemaVersion",
                "instanceId",
                "condition",
                "predeclarationDigest",
                "runId",
                "attemptId",
                "producerVersion",
                "terminalStatus",
            )
        }
        selection["attemptPath"] = output.resolve().relative_to(ROOT).as_posix()
        _atomic_write_json(
            GATE_B_ROOT / "attempts" / "agent" / instance_id / "selected.json",
            selection,
        )
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
