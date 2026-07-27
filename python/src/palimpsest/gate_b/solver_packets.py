from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, validate_value

from .artifacts import artifact_reference, write_canonical
from .config import (
    FRONTIER_MAX_OUTPUT_TOKENS,
    FRONTIER_MODEL,
    FRONTIER_REASONING_EFFORT,
    FRONTIER_REASONING_SUMMARY,
    GATE_B_INSTANCES,
)

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
REFERENCE_PATH = ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"
PUBLIC_PACKET_FIELDS = {
    "schemaVersion",
    "contractId",
    "instanceId",
    "condition",
    "publicManifest",
    "cipherView",
    "referenceCorpus",
    "instructions",
    "resourcePolicy",
}

INSTRUCTIONS = (
    "Recover as much of the prepared plaintext as possible from the stationary "
    "word-substitution cipher.\n\n"
    "The same normalized plaintext word type always maps to the same ciphertext type. "
    "The key is a bijection and has no fixed points. The candidate plaintext vocabulary "
    "is exactly the visible ciphertext vocabulary. Preserve punctuation, capitalization, "
    "digits, paragraphs, and chapter boundaries.\n\n"
    "Work without network access. Record a complete reconstruction and any mapping "
    "hypotheses at each checkpoint. Report source-identification claims separately; "
    "do not copy a retrieved source into the reconstruction.\n"
)
PRE_SOLVE_ADMISSION_POLICY = {
    "schemaVersion": 1,
    "policyId": "same-model-pre-solve-v1",
    "model": FRONTIER_MODEL,
    "reasoningEffort": "medium",
    "reasoningSummary": FRONTIER_REASONING_SUMMARY,
    "maximumActiveWorkSeconds": 900,
    "maxOutputTokens": 8_000,
    "maxToolCalls": 4,
    "network": "openai-api-only",
    "containerNetwork": "disabled",
    "minimumAlignedExcerptTokens": 40,
    "admissionRule": {
        "recognized-literary": "exact-title-or-aligned-reconstruction-required",
        "unrecognized-literary": "exact-title-and-aligned-reconstruction-forbidden",
        "unrecognized-non-literary": "exact-title-and-aligned-reconstruction-forbidden",
    },
}


def produce_policies() -> dict[str, dict[str, Any]]:
    instructions_ref = write_canonical(
        GATE_B_ROOT / "inputs" / "solver-policies" / "instructions.json",
        {"schemaVersion": 1, "text": INSTRUCTIONS},
    )
    policy_refs = {}
    for condition in ("frontier-agent-tools", "human-tools"):
        frontier_fields = (
            {
                "apiSdk": "openai-python-2.48.0",
                "containerMemory": "1g",
                "containerNetwork": "disabled",
                "maxOutputTokens": FRONTIER_MAX_OUTPUT_TOKENS,
                "maxToolCallsPerCheckpoint": 20,
                "model": FRONTIER_MODEL,
                "reasoningEffort": FRONTIER_REASONING_EFFORT,
                "reasoningSummary": FRONTIER_REASONING_SUMMARY,
                "requiredTool": "openai-code-interpreter",
                "streamedEvidence": [
                    "detailed-reasoning-summary",
                    "python-code",
                    "python-output",
                    "tool-status",
                ],
            }
            if condition == "frontier-agent-tools"
            else {}
        )
        policy_refs[condition] = write_canonical(
            GATE_B_ROOT / "inputs" / "solver-policies" / f"{condition}.json",
            {
                "schemaVersion": 1,
                "condition": condition,
                "network": (
                    "openai-api-only" if condition == "frontier-agent-tools" else "disabled"
                ),
                "maximumActiveWorkSeconds": 3_600,
                "checkpointSeconds": [600, 1_800, 3_600],
                "checkpointTurns": [1, 2, 3],
                "allowedTools": (
                    ["openai-code-interpreter"]
                    if condition == "frontier-agent-tools"
                    else [
                        "local-files",
                        "python",
                        "shell",
                        "frozen-distilroberta",
                    ]
                ),
                **frontier_fields,
            },
        )
    policy_refs["mechanical"] = write_canonical(
        GATE_B_ROOT / "inputs" / "solver-policies" / "mechanical.json",
        {
            "network": "disabled",
            "schemaVersion": 1,
            "wallSecondsByRung": [60, 600, 600, 900, 900],
        },
    )
    policy_refs["pre-solve-admission"] = write_canonical(
        GATE_B_ROOT / "inputs" / "solver-policies" / "pre-solve-admission.json",
        PRE_SOLVE_ADMISSION_POLICY,
    )
    return {"instructions": instructions_ref, **policy_refs}


def produce_solver_packets() -> dict[str, Any]:
    policies = produce_policies()
    instructions_ref = policies["instructions"]
    policy_refs = {
        condition: policies[condition] for condition in ("frontier-agent-tools", "human-tools")
    }
    packet_refs = []
    for config in GATE_B_INSTANCES:
        instance_root = GATE_B_ROOT / "instances" / config.instance_id
        public_manifest_path = instance_root / "public" / "manifest.json"
        cipher_path = instance_root / "public" / "cipher.txt"
        for condition, policy_ref in policy_refs.items():
            packet = {
                "schemaVersion": 1,
                "contractId": "gate-b-solver-input-manifest",
                "instanceId": config.instance_id,
                "condition": condition,
                "publicManifest": artifact_reference(
                    public_manifest_path, "public-instance-manifest"
                ),
                "cipherView": artifact_reference(cipher_path, "cipher-view"),
                "referenceCorpus": artifact_reference(
                    REFERENCE_PATH,
                    "target-excluded-reference-corpus",
                ),
                "instructions": instructions_ref,
                "resourcePolicy": policy_ref,
            }
            if set(packet) != PUBLIC_PACKET_FIELDS:
                raise RuntimeError("Solver packet fields diverged from the public allowlist.")
            verdict = validate_value("gate-b-solver-input-manifest", packet)
            if not verdict.accepted:
                raise ValueError(
                    f"gate-b-solver-input-manifest rejected: {verdict.reason} at {verdict.pointer}"
                )
            packet_refs.append(
                write_canonical(
                    GATE_B_ROOT / "solver-packets" / condition / f"{config.instance_id}.json",
                    packet,
                )
            )
    result = {"schemaVersion": 1, "packetCount": len(packet_refs), "packets": packet_refs}
    write_canonical(GATE_B_ROOT / "solver-packets" / "manifest.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true")
    group.add_argument("--policies", action="store_true")
    args = parser.parse_args()
    result = produce_solver_packets() if args.all else produce_policies()
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
