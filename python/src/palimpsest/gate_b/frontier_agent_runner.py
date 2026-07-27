from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import TracebackType
from typing import Any

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, ValidationError

from palimpsest.contracts import canonical_json_bytes
from palimpsest.generation.text import (
    TextSpan,
    apply_capitalization,
    render,
    tokenize,
    word_tokens,
)

from .config import (
    FRONTIER_MAX_OUTPUT_TOKENS,
    FRONTIER_MODEL,
    FRONTIER_REASONING_EFFORT,
    FRONTIER_REASONING_SUMMARY,
    GATE_B_INSTANCES,
    TARGET_TOKEN_COUNT,
)
from .pre_solve_canary import require_admitted_matrix

ROOT = Path(__file__).resolve().parents[4]
GATE_B_ROOT = ROOT / "artifacts" / "gate-b"
REFERENCE_PATH = ROOT / "artifacts" / "gate-a" / "inputs" / "sources" / "count-of-monte-cristo.txt"
FRONTIER_PRODUCER_VERSION = "frontier-agent-runner/2.1.0"
TERMINAL_STATUSES = {"completed", "failed", "superseded"}


@dataclass(frozen=True)
class Attempt:
    instance_id: str
    predeclaration_digest: str
    run_id: str
    attempt_id: str
    started_at: str
    root: Path
    instance_root: Path


def _utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


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
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def _predeclaration_digest() -> str:
    value = json.loads((GATE_B_ROOT / "predeclaration.json").read_text(encoding="utf-8"))
    digest = value.get("predeclarationDigest")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ValueError("Gate B predeclaration has no valid digest.")
    return digest


def _attempt_metadata(attempt: Attempt, status: str) -> dict[str, Any]:
    return {
        "schemaVersion": 2,
        "instanceId": attempt.instance_id,
        "predeclarationDigest": attempt.predeclaration_digest,
        "runId": attempt.run_id,
        "attemptId": attempt.attempt_id,
        "producerVersion": FRONTIER_PRODUCER_VERSION,
        "attemptPath": attempt.root.relative_to(ROOT).as_posix(),
        "startTime": attempt.started_at,
        "status": status,
    }


def _write_attempt_status(
    attempt: Attempt,
    status: str,
    *,
    error: BaseException | None = None,
) -> None:
    if status not in {"running", *TERMINAL_STATUSES}:
        raise ValueError(f"Unsupported attempt status: {status}")
    record = _attempt_metadata(attempt, status)
    if status in TERMINAL_STATUSES:
        record["endTime"] = _utc_now()
    if error is not None:
        record["errorType"] = type(error).__name__
        record["errorMessage"] = str(error)
    _atomic_write_json(attempt.root / "status.json", record)


def _write_current(attempt: Attempt, status: str) -> None:
    _atomic_write_json(attempt.instance_root / "current.json", _attempt_metadata(attempt, status))


def _attempt_from_pointer(instance_root: Path, pointer: dict[str, Any]) -> Attempt:
    required = {
        "instanceId",
        "predeclarationDigest",
        "runId",
        "attemptId",
        "attemptPath",
        "startTime",
    }
    if not required.issubset(pointer) or not all(
        isinstance(pointer[field], str) for field in required
    ):
        raise ValueError("Existing current.json is malformed.")
    root = ROOT / pointer["attemptPath"]
    expected = instance_root / pointer["predeclarationDigest"] / pointer["runId"]
    if root.resolve() != expected.resolve():
        raise ValueError("Existing current.json points outside its declared attempt directory.")
    return Attempt(
        instance_id=pointer["instanceId"],
        predeclaration_digest=pointer["predeclarationDigest"],
        run_id=pointer["runId"],
        attempt_id=pointer["attemptId"],
        started_at=pointer["startTime"],
        root=root,
        instance_root=instance_root,
    )


def _supersede_abandoned_current(instance_root: Path) -> None:
    current_path = instance_root / "current.json"
    if not current_path.exists():
        return
    pointer = json.loads(current_path.read_text(encoding="utf-8"))
    if pointer.get("status") != "running":
        return
    attempt = _attempt_from_pointer(instance_root, pointer)
    _write_attempt_status(attempt, "superseded")
    _write_current(attempt, "superseded")


class InstanceLock:
    def __init__(self, instance_root: Path) -> None:
        self.instance_root = instance_root
        self.lock: Any = None

    def __enter__(self) -> Any:
        self.instance_root.mkdir(parents=True, exist_ok=True)
        self.lock = (self.instance_root / ".run.lock").open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.lock.close()
            raise RuntimeError(
                f"A frontier-agent run is already active for {self.instance_root.name}."
            ) from error
        self.lock.seek(0)
        self.lock.truncate()
        self.lock.write(f"{os.getpid()}\n")
        self.lock.flush()
        return self.lock

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        assert self.lock is not None
        try:
            fcntl.flock(self.lock.fileno(), fcntl.LOCK_UN)
        finally:
            self.lock.close()
        return False


def _instance_lock(instance_root: Path) -> InstanceLock:
    return InstanceLock(instance_root)


def _create_attempt(
    instance_id: str,
    predeclaration_digest: str,
    *,
    run_id: str | None = None,
    started_at: str | None = None,
) -> Attempt:
    instance_root = GATE_B_ROOT / "work" / "agent" / instance_id
    run_id = run_id or (f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:12]}")
    started_at = started_at or _utc_now()
    root = instance_root / predeclaration_digest / run_id
    root.mkdir(parents=True, exist_ok=False)
    attempt = Attempt(
        instance_id=instance_id,
        predeclaration_digest=predeclaration_digest,
        run_id=run_id,
        attempt_id=f"{instance_id}-frontier-agent-tools-{run_id}",
        started_at=started_at,
        root=root,
        instance_root=instance_root,
    )
    _write_attempt_status(attempt, "running")
    _write_current(attempt, "running")
    return attempt


class SolverTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    checkpoint_ready: bool
    identification_claims: list[str]
    notes: list[str]


def _validate_mapping(value: Any, vocabulary: set[str]) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("mapping.json must contain one JSON object.")
    mapping: dict[str, str] = {}
    for ciphertext, plaintext in value.items():
        if not isinstance(ciphertext, str) or not isinstance(plaintext, str):
            raise ValueError("Every mapping key and value must be a string.")
        cipher_word = ciphertext.casefold()
        plain_word = plaintext.casefold()
        outside = sorted({word for word in (cipher_word, plain_word) if word not in vocabulary})
        if outside:
            raise ValueError(
                "Every mapping word must occur exactly in the canonical cipher vocabulary; "
                f"off-vocabulary values: {', '.join(outside)}."
            )
        if cipher_word == plain_word:
            raise ValueError("The mapping contains a forbidden fixed point.")
        mapping[cipher_word] = plain_word
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("The mapping must be one-to-one.")
    return dict(sorted(mapping.items()))


def _apply_partial_mapping(cipher_text: str, mapping: dict[str, str]) -> str:
    output: list[TextSpan] = []
    for span in tokenize(cipher_text):
        if not span.is_word:
            output.append(span)
            continue
        assert span.normalized is not None
        replacement = mapping.get(span.normalized)
        if replacement is None:
            output.append(span)
        else:
            output.append(
                TextSpan(
                    apply_capitalization(span.surface, replacement),
                    replacement,
                    True,
                )
            )
    return render(output)


def _initial_prompt() -> str:
    return (
        "Solve the stationary whole-word substitution cipher using the python tool as your "
        "working environment. The mounted files /mnt/data/cipher.txt and "
        "/mnt/data/reference.txt are your only text corpora. The mounted "
        "/mnt/data/vocabulary.json contains the exact canonical normalized spellings that "
        "mapping.json must use, including curly apostrophes; locate mounted files by their "
        "filename suffix if the container prefixes their names. Do not load or reproduce "
        "the entire cipher in your response context. Instead, write and iteratively run "
        "Python that measures frequencies and contexts, tests hypotheses, and maintains "
        "/mnt/data/solver.py, /mnt/data/mapping.json, /mnt/data/reconstruction.txt, and "
        "/mnt/data/worklog.md. The code and tool outputs are part of the required evidence.\n\n"
        "mapping.json must be a plain JSON object whose keys are normalized ciphertext "
        "words and values are normalized plaintext words; do not wrap it in metadata. "
        "The candidate plaintext vocabulary is exactly the ciphertext vocabulary. The "
        "mapping is bijective and has no fixed points. Do not claim that an unchanged "
        "ciphertext word is decoded. Use syntax, repeated contexts, discourse coherence, "
        "capitalization, punctuation, and the target-excluded reference. Focus first on "
        "function words, then expand into content and regenerated entity words. "
        "Identification claims must stay separate and must never be used to copy a source "
        "passage. The ciphertext contains exactly "
        f"{TARGET_TOKEN_COUNT} word tokens.\n\n"
        "Before returning the structured checkpoint, you must use the python tool and save "
        "your current code, mapping, reconstruction, and concise work log in /mnt/data. "
        "Do not repeat the mapping in the response; set checkpoint_ready true only after "
        "all four files are current and valid."
        "\n\nThis is checkpoint 1 of 3, not the final solution. Use no more than 15 "
        "python-tool calls in this turn. On or before call 15, save the strongest current "
        "artifacts and immediately return the structured checkpoint. Do not spend the "
        "remaining call budget on further refinement."
    )


def _revision_prompt(*, sequence: int) -> str:
    return (
        f"Checkpoint turn {sequence + 1} of 3. Continue from the files in the same python "
        "tool container. Inspect and improve /mnt/data/solver.py, /mnt/data/mapping.json, "
        "/mnt/data/reconstruction.txt, and /mnt/data/worklog.md by running Python; do not "
        "move the whole cipher into the response context. Refine and expand the mapping, "
        "resolve contradictions through measured grammatical and discourse coherence, and "
        "save the updated files before returning. Unknown tokens remain visible as "
        "ciphertext words and are not decoded fixed points. Keep mapping.json as the plain "
        "ciphertext-to-plaintext JSON object. Do not repeat the mapping in the response; "
        "set checkpoint_ready true only after all four files are current and valid. This is "
        "an evidence checkpoint, not permission to solve indefinitely: use no more than 15 "
        "python-tool calls in this turn, save on or before call 15, and immediately return "
        "the structured checkpoint."
    )


def _validation_errors(error: ValidationError) -> list[dict[str, Any]]:
    return json.loads(
        error.json(
            include_context=False,
            include_input=False,
            include_url=False,
        )
    )


def _usage_record(response: Any, active_seconds: float) -> dict[str, Any]:
    usage = response.usage
    return {
        "activeSeconds": active_seconds,
        "model": FRONTIER_MODEL,
        "reasoningEffort": FRONTIER_REASONING_EFFORT,
        "responseId": response.id,
        "inputTokens": usage.input_tokens if usage else 0,
        "outputTokens": usage.output_tokens if usage else 0,
        "totalTokens": usage.total_tokens if usage else 0,
        "reasoningTokens": (
            usage.output_tokens_details.reasoning_tokens
            if usage and usage.output_tokens_details
            else 0
        ),
    }


def _failure_record(response: Any, active_seconds: float) -> dict[str, Any]:
    incomplete_details = getattr(response, "incomplete_details", None)
    return {
        "activeSeconds": active_seconds,
        "incompleteDetails": (
            incomplete_details.model_dump(mode="json") if incomplete_details is not None else None
        ),
        "responseId": response.id,
        "schemaVersion": 1,
        "status": response.status,
        "toolEvents": _tool_events(response),
        "usage": _usage_record(response, active_seconds),
    }


def _tool_events(response: Any) -> list[dict[str, Any]]:
    return [
        item.model_dump(mode="json")
        for item in response.output
        if item.type == "code_interpreter_call"
    ]


def _container_artifacts(
    client: OpenAI,
    container_id: str,
) -> tuple[list[dict[str, Any]], dict[str, bytes]]:
    files = {
        Path(item.path).name: item
        for item in client.containers.files.list(
            container_id,
            limit=100,
            order="asc",
        )
    }
    required = {
        "mapping.json",
        "reconstruction.txt",
        "solver.py",
        "worklog.md",
    }
    missing = sorted(required - files.keys())
    if missing:
        raise RuntimeError(
            f"Python tool container omitted required work files: {', '.join(missing)}."
        )
    records = []
    contents = {}
    for name in sorted(required):
        item = files[name]
        content = client.containers.files.content.retrieve(
            item.id,
            container_id=container_id,
        ).read()
        contents[name] = content
        records.append(
            {
                "byteLength": len(content),
                "content": (
                    content.decode("utf-8") if name in {"solver.py", "worklog.md"} else None
                ),
                "path": f"/mnt/data/{name}",
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    return records, contents


def _safe_stream_event(event: Any, elapsed_seconds: float) -> dict[str, Any] | None:
    safe_types = {
        "response.code_interpreter_call.in_progress",
        "response.code_interpreter_call_code.delta",
        "response.code_interpreter_call_code.done",
        "response.code_interpreter_call.interpreting",
        "response.code_interpreter_call.completed",
        "response.reasoning_summary_text.delta",
        "response.reasoning_summary_text.done",
    }
    if event.type in safe_types:
        return {
            "elapsedSeconds": elapsed_seconds,
            "event": event.model_dump(mode="json"),
        }
    if event.type == "response.output_item.done" and event.item.type == "code_interpreter_call":
        return {
            "elapsedSeconds": elapsed_seconds,
            "event": event.model_dump(mode="json"),
        }
    if event.type in {
        "response.created",
        "response.in_progress",
        "response.completed",
        "response.failed",
        "response.incomplete",
        "error",
    }:
        response = getattr(event, "response", None)
        return {
            "elapsedSeconds": elapsed_seconds,
            "event": {
                "response_id": getattr(response, "id", None),
                "sequence_number": event.sequence_number,
                "status": getattr(response, "status", None),
                "type": event.type,
            },
        }
    return None


def _render_stream_event(event: Any, sequence: int) -> str | None:
    if event.type == "response.code_interpreter_call_code.delta":
        return event.delta
    if event.type == "response.code_interpreter_call_code.done":
        return f"\n[checkpoint {sequence + 1}: python code complete]\n"
    if event.type == "response.code_interpreter_call.interpreting":
        return f"[checkpoint {sequence + 1}: running python]\n"
    if event.type == "response.output_item.done" and (event.item.type == "code_interpreter_call"):
        rendered = ""
        for output in event.item.outputs or []:
            if output.type == "logs" and output.logs:
                rendered += f"[checkpoint {sequence + 1}: python output]\n{output.logs}\n"
        return rendered or None
    if event.type == "response.reasoning_summary_text.delta":
        return event.delta
    if event.type == "response.reasoning_summary_text.done":
        return f"\n[checkpoint {sequence + 1}: detailed reasoning summary complete]\n"
    return None


def _stream_response(
    *,
    client: OpenAI,
    container_id: str,
    live_path: Path,
    output_root: Path,
    previous_response_id: str | None,
    prompt: str,
    remaining_seconds: float,
    sequence: int,
    started: float,
) -> tuple[Any, list[dict[str, Any]]]:
    stream_path = output_root / f"stream-{sequence}.jsonl"
    stream_path.write_bytes(b"")
    records: list[dict[str, Any]] = []
    started_message = f"[checkpoint {sequence + 1}: response started]\n"
    print(started_message, end="", flush=True)
    with live_path.open("a", encoding="utf-8") as destination:
        destination.write(started_message)
    stream = client.responses.create(
        model=FRONTIER_MODEL,
        reasoning={
            "effort": FRONTIER_REASONING_EFFORT,
            "summary": FRONTIER_REASONING_SUMMARY,
        },
        input=prompt,
        previous_response_id=previous_response_id,
        tools=[{"type": "code_interpreter", "container": container_id}],
        tool_choice="required",
        max_tool_calls=20,
        max_output_tokens=FRONTIER_MAX_OUTPUT_TOKENS,
        store=True,
        stream=True,
        text={
            "format": {
                "name": "SolverTurn",
                "schema": SolverTurn.model_json_schema(),
                "strict": True,
                "type": "json_schema",
            },
            "verbosity": "low",
        },
        timeout=remaining_seconds,
    )
    response = None
    for event in stream:
        rendered = _render_stream_event(event, sequence)
        if rendered is not None:
            print(rendered, end="", flush=True)
            with live_path.open("a", encoding="utf-8") as destination:
                destination.write(rendered)
                destination.flush()
        record = _safe_stream_event(event, time.monotonic() - started)
        if record is not None:
            records.append(record)
            with stream_path.open("ab") as destination:
                destination.write(canonical_json_bytes(record) + b"\n")
        if event.type in {
            "response.completed",
            "response.failed",
            "response.incomplete",
        }:
            response = event.response
    if response is None:
        raise RuntimeError("Responses stream ended without a terminal response event.")
    completed_message = f"[checkpoint {sequence + 1}: response complete]\n"
    print(completed_message, end="", flush=True)
    with live_path.open("a", encoding="utf-8") as destination:
        destination.write(completed_message)
    return response, records


def run_instance(instance_id: str) -> dict[str, Any]:
    require_admitted_matrix()
    config = next(
        (candidate for candidate in GATE_B_INSTANCES if candidate.instance_id == instance_id),
        None,
    )
    if config is None:
        raise ValueError(f"Unknown Gate B instance: {instance_id}")
    instance_root = GATE_B_ROOT / "instances" / instance_id
    cipher_text = (instance_root / "public" / "cipher.txt").read_text(encoding="utf-8")
    vocabulary = {
        token.normalized for token in word_tokens(cipher_text) if token.normalized is not None
    }
    if len(word_tokens(cipher_text)) != TARGET_TOKEN_COUNT:
        raise ValueError(f"{instance_id} cipher does not contain {TARGET_TOKEN_COUNT} tokens.")
    predeclaration_digest = _predeclaration_digest()
    instance_work_root = GATE_B_ROOT / "work" / "agent" / instance_id
    with _instance_lock(instance_work_root):
        _supersede_abandoned_current(instance_work_root)
        attempt = _create_attempt(instance_id, predeclaration_digest)
        output_root = attempt.root
        try:
            client = OpenAI()
            cipher_file = client.files.create(
                file=("cipher.txt", cipher_text.encode("utf-8"), "text/plain"),
                purpose="user_data",
            )
            reference_file = client.files.create(
                file=("reference.txt", REFERENCE_PATH.read_bytes(), "text/plain"),
                purpose="user_data",
            )
            vocabulary_file = client.files.create(
                file=(
                    "vocabulary.json",
                    canonical_json_bytes(sorted(vocabulary)),
                    "application/json",
                ),
                purpose="user_data",
            )
            container = client.containers.create(
                name=f"palimpsest-gate-b-{instance_id}-{attempt.run_id}",
                file_ids=[cipher_file.id, reference_file.id, vocabulary_file.id],
                memory_limit="1g",
                network_policy={"type": "disabled"},
            )
            live_path = output_root / "live.log"
            live_path.write_text(
                f"Palimpsest Gate B live solver trace\ninstance={instance_id}\n"
                f"predeclaration={predeclaration_digest}\nrun={attempt.run_id}\n"
                f"attempt={attempt.attempt_id}\nmodel={FRONTIER_MODEL}\n"
                f"reasoning={FRONTIER_REASONING_EFFORT}\n",
                encoding="utf-8",
            )
            mapping: dict[str, str] = {}
            previous_response_id: str | None = None
            checkpoints = []
            started = time.monotonic()
            for sequence in range(3):
                remaining_seconds = 3_600 - (time.monotonic() - started)
                if remaining_seconds <= 0:
                    raise TimeoutError(
                        f"{instance_id} exhausted its 3,600-second active-work allowance."
                    )
                prompt = _initial_prompt() if sequence == 0 else _revision_prompt(sequence=sequence)
                response, stream_events = _stream_response(
                    client=client,
                    container_id=container.id,
                    live_path=live_path,
                    output_root=output_root,
                    previous_response_id=previous_response_id,
                    prompt=prompt,
                    remaining_seconds=remaining_seconds,
                    sequence=sequence,
                    started=started,
                )
                try:
                    parsed = SolverTurn.model_validate_json(response.output_text)
                except ValidationError as error:
                    elapsed = time.monotonic() - started
                    failure_path = output_root / f"failure-{sequence}.json"
                    failure_path.write_bytes(
                        canonical_json_bytes(
                            {
                                **_failure_record(response, elapsed),
                                "outputText": response.output_text,
                                "validationError": _validation_errors(error),
                            }
                        )
                    )
                    raise RuntimeError(
                        f"{instance_id} checkpoint {sequence} produced invalid structured output; "
                        f"diagnostics written to {failure_path.relative_to(ROOT)}."
                    ) from error
                tool_events = _tool_events(response)
                if not tool_events:
                    raise RuntimeError(
                        f"{instance_id} checkpoint {sequence} did not use the required python tool."
                    )
                if not parsed.checkpoint_ready:
                    raise RuntimeError(
                        f"{instance_id} checkpoint {sequence} was not marked ready by the solver."
                    )
                try:
                    container_artifacts, container_contents = _container_artifacts(
                        client,
                        container.id,
                    )
                    mapping = _validate_mapping(
                        json.loads(container_contents["mapping.json"]),
                        vocabulary,
                    )
                except (json.JSONDecodeError, RuntimeError, ValueError) as error:
                    elapsed = time.monotonic() - started
                    failure_path = output_root / f"failure-{sequence}.json"
                    failure_path.write_bytes(
                        canonical_json_bytes(
                            {
                                **_failure_record(response, elapsed),
                                "artifactValidationError": str(error),
                            }
                        )
                    )
                    raise RuntimeError(
                        f"{instance_id} checkpoint {sequence} produced invalid "
                        "container artifacts; "
                        f"diagnostics written to {failure_path.relative_to(ROOT)}."
                    ) from error
                reconstruction = _apply_partial_mapping(cipher_text, mapping)
                elapsed = time.monotonic() - started
                reconstruction_name = f"reconstruction-{sequence}.txt"
                mapping_name = f"mapping-{sequence}.json"
                tools_name = f"tools-{sequence}.json"
                claims_name = f"claims-{sequence}.json"
                usage_name = f"usage-{sequence}.json"
                (output_root / reconstruction_name).write_text(reconstruction, encoding="utf-8")
                (output_root / mapping_name).write_bytes(canonical_json_bytes(mapping))
                (output_root / tools_name).write_bytes(
                    canonical_json_bytes(
                        [
                            {
                                "tool": "openai-responses-stream",
                                "eventCount": len(stream_events),
                                "events": stream_events,
                            },
                            {
                                "tool": "openai-responses",
                                "responseId": response.id,
                                "model": FRONTIER_MODEL,
                                "containerId": container.id,
                            },
                            *tool_events,
                            {
                                "tool": "openai-container-artifacts",
                                "artifacts": container_artifacts,
                            },
                            {
                                "tool": "local-apply-mapping",
                                "mappingSize": len(mapping),
                            },
                        ]
                    )
                )
                (output_root / claims_name).write_bytes(
                    canonical_json_bytes(parsed.identification_claims)
                )
                (output_root / usage_name).write_bytes(
                    canonical_json_bytes(_usage_record(response, elapsed))
                )
                checkpoints.append(
                    {
                        "sequence": sequence,
                        "trustedElapsedSeconds": elapsed,
                        "reconstructionPath": reconstruction_name,
                        "mappingPath": mapping_name,
                        "toolEventsPath": tools_name,
                        "identificationClaimsPath": claims_name,
                        "usagePath": usage_name,
                        "predeclarationDigest": predeclaration_digest,
                        "runId": attempt.run_id,
                    }
                )
                previous_response_id = response.id
            manifest = {
                "schemaVersion": 2,
                "instanceId": instance_id,
                "condition": "frontier-agent-tools",
                "solverIdentity": f"openai-responses/{FRONTIER_MODEL}/openai-python-2.48.0",
                "predeclarationDigest": predeclaration_digest,
                "runId": attempt.run_id,
                "attemptId": attempt.attempt_id,
                "producerVersion": FRONTIER_PRODUCER_VERSION,
                "terminalStatus": "completed",
                "checkpoints": checkpoints,
            }
            _atomic_write_json(output_root / "manifest.json", manifest)
            _write_attempt_status(attempt, "completed")
            _write_current(attempt, "completed")
            return {
                "instanceId": instance_id,
                "predeclarationDigest": predeclaration_digest,
                "runId": attempt.run_id,
                "attemptId": attempt.attempt_id,
                "checkpointCount": len(checkpoints),
                "mappingSize": len(mapping),
                "output": str(output_root.relative_to(ROOT)),
            }
        except BaseException as error:
            _write_attempt_status(attempt, "failed", error=error)
            _write_current(attempt, "failed")
            raise


def main() -> None:
    parser = argparse.ArgumentParser()
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--instance")
    selection.add_argument("--all", action="store_true")
    args = parser.parse_args()
    instance_ids = (
        [config.instance_id for config in GATE_B_INSTANCES] if args.all else [args.instance]
    )
    result = {
        "schemaVersion": 1,
        "model": FRONTIER_MODEL,
        "instances": [run_instance(instance_id) for instance_id in instance_ids],
    }
    print(canonical_json_bytes(result).decode())


if __name__ == "__main__":
    main()
