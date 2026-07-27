from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field

from palimpsest.contracts import canonical_json_bytes
from palimpsest.generation.text import word_tokens

from .artifacts import artifact_reference, write_canonical
from .config import (
    FRONTIER_MODEL,
    FRONTIER_REASONING_SUMMARY,
    GATE_B_INSTANCES,
    GateBInstanceConfig,
)
from .solver_packets import PRE_SOLVE_ADMISSION_POLICY

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
REFERENCE_PATH = ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"
PRODUCER_VERSION = "same-model-pre-solve-canary/1.0.0"


class AdmissionTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    work_candidates: list[str] = Field(max_length=5)
    author_candidates: list[str] = Field(max_length=5)
    reconstructed_excerpt: str
    notes: list[str] = Field(max_length=8)


def _normalized_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _primary_title(value: str) -> str:
    return re.split(r"[:;]", value, maxsplit=1)[0]


def _title_identified(config: GateBInstanceConfig, candidates: list[str]) -> bool:
    expected = _normalized_identifier(_primary_title(config.title))
    return any(
        expected == (candidate_value := _normalized_identifier(candidate))
        or expected in candidate_value
        or (len(candidate_value) >= 8 and candidate_value in expected)
        for candidate in candidates
    )


def _exact_aligned_excerpt(prepared_text: str, excerpt: str) -> bool:
    candidate = [token.normalized for token in word_tokens(excerpt) if token.normalized is not None]
    minimum = PRE_SOLVE_ADMISSION_POLICY["minimumAlignedExcerptTokens"]
    if len(candidate) < minimum:
        return False
    truth = [
        token.normalized for token in word_tokens(prepared_text) if token.normalized is not None
    ]
    width = len(candidate)
    return any(truth[index : index + width] == candidate for index in range(len(truth) - width + 1))


def classify_admission(
    config: GateBInstanceConfig,
    turn: AdmissionTurn,
    prepared_text: str,
) -> dict[str, bool]:
    title_identified = _title_identified(config, turn.work_candidates)
    exact_aligned = _exact_aligned_excerpt(prepared_text, turn.reconstructed_excerpt)
    observed_recognized = title_identified or exact_aligned
    expected_recognized = config.diagnostic_role == "recognized-literary"
    return {
        "titleIdentified": title_identified,
        "exactAlignedReconstruction": exact_aligned,
        "observedRecognized": observed_recognized,
        "expectedRecognized": expected_recognized,
        "admitted": observed_recognized == expected_recognized,
    }


def _predeclaration_digest() -> str:
    value = json.loads((GATE_B_ROOT / "predeclaration.json").read_text(encoding="utf-8"))
    digest = value.get("predeclarationDigest")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ValueError("Gate B predeclaration has no valid digest.")
    return digest


def require_admitted_matrix() -> dict[str, Any]:
    summary_path = GATE_B_ROOT / "admission" / "summary.json"
    if not summary_path.exists():
        raise RuntimeError("Gate B matrix has no same-model pre-solve admission summary.")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    digest = _predeclaration_digest()
    expected_ids = {config.instance_id for config in GATE_B_INSTANCES}
    results = summary.get("results")
    if (
        summary.get("predeclarationDigest") != digest
        or summary.get("allAdmitted") is not True
        or not isinstance(results, list)
        or {result.get("instanceId") for result in results if isinstance(result, dict)}
        != expected_ids
        or any(
            not isinstance(result, dict)
            or result.get("predeclarationDigest") != digest
            or result.get("admitted") is not True
            for result in results
        )
    ):
        raise RuntimeError("Gate B matrix is not fully admitted under the current predeclaration.")
    return summary


def _prompt() -> str:
    return (
        "This is a frozen source-recognition admission canary, not a full solving run. "
        "Use the python tool to inspect only the mounted Gate B solver packet and its "
        "declared files. The container has no network access and no oracle. Determine "
        "whether you recognize the exact work, and whether you can reconstruct an exact "
        "aligned passage from memory or the allowed target-excluded reference. Return at "
        "most five exact work-title candidates and five author candidates. If possible, "
        "return one continuous reconstructed excerpt of at least 40 word tokens; otherwise "
        "return an empty excerpt. Do not infer a title from any hidden metadata, because "
        "none is provided. Keep notes concise and do not attempt a full substitution solve."
    )


def _input_files(instance_id: str) -> list[tuple[str, Path]]:
    instance_root = GATE_B_ROOT / "instances" / instance_id
    packet_root = GATE_B_ROOT / "solver-packets" / "frontier-agent-tools"
    policy_root = GATE_B_ROOT / "inputs" / "solver-policies"
    return [
        ("solver-packet.json", packet_root / f"{instance_id}.json"),
        ("public-manifest.json", instance_root / "public" / "manifest.json"),
        ("cipher.txt", instance_root / "public" / "cipher.txt"),
        ("reference.txt", REFERENCE_PATH),
        ("instructions.json", policy_root / "instructions.json"),
        ("resource-policy.json", policy_root / "frontier-agent-tools.json"),
        ("admission-policy.json", policy_root / "pre-solve-admission.json"),
    ]


def _response_record(response: Any) -> dict[str, Any]:
    usage = response.usage
    incomplete_details = getattr(response, "incomplete_details", None)
    return {
        "schemaVersion": 1,
        "responseId": response.id,
        "status": response.status,
        "incompleteDetails": (
            incomplete_details.model_dump(mode="json") if incomplete_details is not None else None
        ),
        "outputText": response.output_text,
        "output": [item.model_dump(mode="json", warnings=False) for item in response.output],
        "usage": {
            "inputTokens": usage.input_tokens if usage else 0,
            "outputTokens": usage.output_tokens if usage else 0,
            "totalTokens": usage.total_tokens if usage else 0,
            "reasoningTokens": (
                usage.output_tokens_details.reasoning_tokens
                if usage and usage.output_tokens_details
                else 0
            ),
        },
    }


def record_canary_failure(
    output_root: Path,
    live_path: Path,
    *,
    digest: str,
    instance_id: str,
    error: BaseException,
) -> None:
    write_canonical(
        output_root / "failure.json",
        {
            "schemaVersion": 1,
            "producerVersion": PRODUCER_VERSION,
            "predeclarationDigest": digest,
            "instanceId": instance_id,
            "errorType": type(error).__name__,
            "errorMessage": str(error),
        },
    )
    live_path.write_text(
        live_path.read_text(encoding="utf-8")
        + f"status=failed\nerror_type={type(error).__name__}\n",
        encoding="utf-8",
    )


def run_canary(instance_id: str) -> dict[str, Any]:
    config = next(
        (candidate for candidate in GATE_B_INSTANCES if candidate.instance_id == instance_id),
        None,
    )
    if config is None:
        raise ValueError(f"Unknown Gate B instance: {instance_id}")
    digest = _predeclaration_digest()
    output_root = GATE_B_ROOT / "admission" / digest / instance_id
    output_root.mkdir(parents=True, exist_ok=False)
    live_path = output_root / "live.log"
    live_path.write_text(
        "Palimpsest Gate B same-model pre-solve canary\n"
        f"instance={instance_id}\npredeclaration={digest}\nmodel={FRONTIER_MODEL}\n"
        f"reasoning={PRE_SOLVE_ADMISSION_POLICY['reasoningEffort']}\n"
        "status=starting\n",
        encoding="utf-8",
    )
    client = OpenAI()
    mounted = []
    input_references = []
    for name, path in _input_files(instance_id):
        media_type = "application/json" if name.endswith(".json") else "text/plain"
        mounted.append(
            client.files.create(
                file=(name, path.read_bytes(), media_type),
                purpose="user_data",
            )
        )
        input_references.append(
            {
                "name": name,
                **artifact_reference(path, "pre-solve-canary-input"),
            }
        )
    container = client.containers.create(
        name=f"palimpsest-gate-b-admission-{instance_id}-{digest[:12]}",
        file_ids=[item.id for item in mounted],
        memory_limit="1g",
        network_policy={"type": "disabled"},
    )
    started = time.monotonic()
    try:
        response = client.responses.parse(
            model=FRONTIER_MODEL,
            reasoning={
                "effort": PRE_SOLVE_ADMISSION_POLICY["reasoningEffort"],
                "summary": FRONTIER_REASONING_SUMMARY,
            },
            input=_prompt(),
            tools=[{"type": "code_interpreter", "container": container.id}],
            tool_choice="required",
            max_tool_calls=PRE_SOLVE_ADMISSION_POLICY["maxToolCalls"],
            max_output_tokens=PRE_SOLVE_ADMISSION_POLICY["maxOutputTokens"],
            store=True,
            text_format=AdmissionTurn,
            timeout=PRE_SOLVE_ADMISSION_POLICY["maximumActiveWorkSeconds"],
        )
    except BaseException as error:
        record_canary_failure(
            output_root,
            live_path,
            digest=digest,
            instance_id=instance_id,
            error=error,
        )
        raise
    response_record = _response_record(response)
    write_canonical(output_root / "response.json", response_record)
    if response.output_parsed is None:
        live_path.write_text(
            live_path.read_text(encoding="utf-8")
            + f"status=failed\nresponse_status={response.status}\n",
            encoding="utf-8",
        )
        raise RuntimeError(
            f"{instance_id} admission canary returned no structured output; "
            f"see {(output_root / 'response.json').relative_to(ROOT)}."
        )
    turn = response.output_parsed
    prepared_path = GATE_B_ROOT / "instances" / instance_id / "sealed" / "prepared.txt"
    classification = classify_admission(
        config,
        turn,
        prepared_path.read_text(encoding="utf-8"),
    )
    result = {
        "schemaVersion": 1,
        "producerVersion": PRODUCER_VERSION,
        "predeclarationDigest": digest,
        "instanceId": instance_id,
        "diagnosticRole": config.diagnostic_role,
        "policy": artifact_reference(
            GATE_B_ROOT / "inputs" / "solver-policies" / "pre-solve-admission.json",
            "pre-solve-admission-policy",
        ),
        "inputs": input_references,
        "model": FRONTIER_MODEL,
        "reasoningEffort": PRE_SOLVE_ADMISSION_POLICY["reasoningEffort"],
        "responseId": response.id,
        "activeSeconds": time.monotonic() - started,
        "usage": response_record["usage"],
        "observation": turn.model_dump(mode="json"),
        **classification,
    }
    write_canonical(output_root / "result.json", result)
    live_path.write_text(
        live_path.read_text(encoding="utf-8")
        + f"status=completed\nadmitted={str(classification['admitted']).lower()}\n",
        encoding="utf-8",
    )
    return result


def merge_admission_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    digest = _predeclaration_digest()
    summary_path = GATE_B_ROOT / "admission" / "summary.json"
    existing = (
        json.loads(summary_path.read_text(encoding="utf-8"))
        if summary_path.exists()
        else {"results": []}
    )
    by_instance = {
        result["instanceId"]: result
        for result in existing.get("results", [])
        if isinstance(result, dict) and result.get("predeclarationDigest") == digest
    }
    by_instance.update({result["instanceId"]: result for result in results})
    expected_order = [config.instance_id for config in GATE_B_INSTANCES]
    ordered = [
        by_instance[instance_id] for instance_id in expected_order if instance_id in by_instance
    ]
    matrix_complete = len(ordered) == len(expected_order)
    return {
        "schemaVersion": 1,
        "predeclarationDigest": digest,
        "results": ordered,
        "matrixComplete": matrix_complete,
        "allAdmitted": matrix_complete and all(result["admitted"] for result in ordered),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--instance")
    selection.add_argument("--all", action="store_true")
    args = parser.parse_args()
    instance_ids = (
        [config.instance_id for config in GATE_B_INSTANCES] if args.all else [args.instance]
    )
    results = [run_canary(instance_id) for instance_id in instance_ids]
    summary = merge_admission_summary(results)
    write_canonical(GATE_B_ROOT / "admission" / "summary.json", summary)
    print(canonical_json_bytes(summary).decode())
    if any(not result["admitted"] for result in results) or (
        args.all and not summary["allAdmitted"]
    ):
        raise SystemExit("Gate B source-role admission failed.")


if __name__ == "__main__":
    main()
