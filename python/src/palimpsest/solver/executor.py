from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
IMAGE_LOCK = REPOSITORY_ROOT / "containers/images.lock.json"
EXPECTED_OUTPUTS = ("reconstruction.txt",)
EXPECTED_AGENTS = frozenset({"agent-1", "agent-2", "agent-3"})
MAXIMUM_OUTPUT_BYTES = 32 * 1024 * 1024


def _artifact(content: bytes, artifact_type: str) -> dict[str, Any]:
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _outputs(root: Path) -> list[dict[str, Any]]:
    files: list[Path] = []
    total_bytes = 0
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Solver output must not be a symbolic link: {path.name}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f"Solver output must be a regular file: {path.name}")
        files.append(path)

    result = []
    for path in sorted(files, key=lambda candidate: candidate.relative_to(root).as_posix()):
        content = path.read_bytes()
        total_bytes += len(content)
        if total_bytes > MAXIMUM_OUTPUT_BYTES:
            raise ValueError("Solver outputs exceed the total byte limit.")
        result.append(
            {
                "path": path.relative_to(root).as_posix(),
                "byteLength": len(content),
                "sha256": sha256_hex(content),
            }
        )
    return result


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate(contract_id: str, value: Any) -> None:
    verdict = validate_value(contract_id, value)
    if not verdict.accepted:
        raise ValueError(f"{contract_id} is invalid: {verdict.reason} at {verdict.pointer}")


def _actual_private_outputs(root: Path) -> list[dict[str, Any]]:
    if not root.is_dir():
        raise ValueError(f"Private submission directory is missing: {root}")
    files: list[Path] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise ValueError(f"Private submission output must not be a symbolic link: {path}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f"Private submission output must be a regular file: {path}")
        if path.name != "manifest.json":
            files.append(path)
    return [
        {
            "path": path.relative_to(root).as_posix(),
            "byteLength": len(content := path.read_bytes()),
            "sha256": sha256_hex(content),
        }
        for path in sorted(files, key=lambda candidate: candidate.relative_to(root).as_posix())
    ]


def verify_frozen_submissions(
    attempt: Path,
    submissions: list[dict[str, Any]],
    run_id: str,
    freeze: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    _validate("freeze-snapshot", freeze)
    if freeze["runId"] != run_id:
        raise ValueError("Freeze run identity mismatch.")

    bindings: dict[str, dict[str, Any]] = {}
    for binding in freeze["finalReleasedShards"]:
        agent_id = binding["agentId"]
        manifest = binding["manifest"]
        if (
            agent_id in bindings
            or agent_id not in EXPECTED_AGENTS
            or manifest["artifactType"] != "released-shard-manifest"
        ):
            raise ValueError("Freeze final released-shard bindings are invalid.")
        bindings[agent_id] = manifest
    if bindings.keys() != EXPECTED_AGENTS:
        raise ValueError("Freeze requires one final released-shard binding per declared agent.")

    agents: set[str] = set()
    for submission in submissions:
        _validate("private-deliverable-manifest", submission)
        agent_id = submission["agentId"]
        if (
            submission["runId"] != run_id
            or submission["freezeId"] != freeze["freezeId"]
            or agent_id in agents
            or agent_id not in bindings
        ):
            raise ValueError("Private submission identity is invalid.")
        if submission["releasedShardDigest"] != bindings[agent_id]["sha256"]:
            raise ValueError(f"Private submission released-shard binding mismatch for {agent_id}.")

        root = attempt / "agents" / agent_id / "private-output"
        manifest_path = root / "manifest.json"
        if (
            not manifest_path.is_file()
            or manifest_path.is_symlink()
            or manifest_path.read_bytes() != canonical_json_bytes(submission)
        ):
            raise ValueError(
                f"Private submission manifest does not match sealed evidence for {agent_id}."
            )
        actual = _actual_private_outputs(root)
        if canonical_json_bytes(actual) != canonical_json_bytes(submission["outputs"]):
            raise ValueError("Private submission exact output set does not match sealed files.")
        agents.add(agent_id)
    if agents != EXPECTED_AGENTS:
        raise ValueError("Grading requires exactly the three declared private submissions.")
    return bindings


def _released_shard_payload(
    attempt: Path, agent_id: str, binding: dict[str, Any]
) -> dict[str, bytes]:
    released = attempt / "agents" / agent_id / "input" / "released"
    manifest_path = released / "release-manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ValueError(f"Final released-shard manifest is missing for {agent_id}.")
    manifest_bytes = manifest_path.read_bytes()
    if (
        len(manifest_bytes) != binding["byteLength"]
        or sha256_hex(manifest_bytes) != binding["sha256"]
    ):
        raise ValueError(f"Final released-shard manifest evidence mismatch for {agent_id}.")
    try:
        manifest = json.loads(manifest_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"Final released-shard manifest is invalid for {agent_id}.") from error
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"schemaVersion", "releaseOrdinal", "chapterIndexes", "chapters"}
        or manifest["schemaVersion"] != 1
        or not isinstance(manifest["releaseOrdinal"], int)
        or isinstance(manifest["releaseOrdinal"], bool)
        or manifest["releaseOrdinal"] < 1
        or not isinstance(manifest["chapterIndexes"], list)
        or not isinstance(manifest["chapters"], list)
        or not manifest["chapterIndexes"]
        or len(manifest["chapterIndexes"]) != len(manifest["chapters"])
    ):
        raise ValueError(f"Final released-shard manifest geometry is invalid for {agent_id}.")

    payload = {"released/release-manifest.json": manifest_bytes}
    previous_index = -1
    for chapter_index, artifact in zip(
        manifest["chapterIndexes"], manifest["chapters"], strict=True
    ):
        if (
            not isinstance(chapter_index, int)
            or isinstance(chapter_index, bool)
            or chapter_index <= previous_index
            or not isinstance(artifact, dict)
            or set(artifact) != {"artifactType", "byteLength", "sha256"}
            or artifact["artifactType"] != "cipher-chapter"
            or not isinstance(artifact["byteLength"], int)
            or isinstance(artifact["byteLength"], bool)
            or artifact["byteLength"] < 0
            or not isinstance(artifact["sha256"], str)
            or re.fullmatch(r"[0-9a-f]{64}", artifact["sha256"]) is None
        ):
            raise ValueError(f"Final released-shard chapter evidence is invalid for {agent_id}.")
        previous_index = chapter_index
        name = f"{chapter_index:03d}.txt"
        chapter_path = released / name
        if not chapter_path.is_file() or chapter_path.is_symlink():
            raise ValueError(f"Final released chapter {name} is missing for {agent_id}.")
        content = chapter_path.read_bytes()
        if len(content) != artifact["byteLength"] or sha256_hex(content) != artifact["sha256"]:
            raise ValueError(f"Final released chapter evidence mismatch for {agent_id}: {name}.")
        payload[f"released/{name}"] = content
    return payload


def stage_solver_inputs(run_id: str, attempt: Path) -> dict[str, Path]:
    freeze = _json(attempt / "git" / "freeze.json")
    submissions = _json(attempt / "submissions.json")
    if not isinstance(submissions, list):
        raise ValueError("Private submissions must be a list.")
    bindings = verify_frozen_submissions(attempt, submissions, run_id, freeze)
    payloads = {
        agent_id: _released_shard_payload(attempt, agent_id, bindings[agent_id])
        for agent_id in sorted(EXPECTED_AGENTS)
    }

    grading = attempt / "grading"
    input_root = grading / "solver-input"
    if input_root.exists():
        raise FileExistsError(f"Clean-solver staging directory already exists: {input_root}")
    grading.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".solver-input-", dir=grading))
    try:
        for agent_id, payload in payloads.items():
            agent_root = temporary / agent_id
            for relative_path, content in payload.items():
                destination = agent_root / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
        temporary.rename(input_root)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return {agent_id: input_root / agent_id for agent_id in sorted(EXPECTED_AGENTS)}


def _locked_solver_image(image_lock: Path) -> str:
    lock = json.loads(image_lock.read_text(encoding="utf-8"))
    image = lock["cleanSolver"]
    tag = image["tag"]
    expected_id = image["imageId"]
    inspected = subprocess.run(
        ["docker", "image", "inspect", "--format", "{{.Id}}", tag],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if inspected != expected_id:
        raise RuntimeError(
            f"Clean-solver image identity mismatch: expected {expected_id}, received {inspected}."
        )
    return expected_id


def _container_name(run_id: str, agent_id: str) -> str:
    normalized = re.sub(r"[^a-z0-9_.-]", "-", f"palimpsest-solver-{run_id}-{agent_id}".lower())
    return normalized[:63]


def _remove_container(name: str) -> None:
    subprocess.run(
        ["docker", "rm", "--force", name],
        check=False,
        capture_output=True,
    )


def execute_solver(
    *,
    run_id: str,
    agent_id: str,
    solver: Path,
    input_root: Path,
    output_root: Path,
    target: bytes,
    timeout_seconds: float = 10,
    image_lock: Path = IMAGE_LOCK,
) -> dict[str, Any]:
    if not solver.is_file():
        raise ValueError(f"Solver executable is missing: {solver}")
    if not input_root.is_dir():
        raise ValueError(f"Solver input directory is missing: {input_root}")
    image_id = _locked_solver_image(image_lock)
    output_root.mkdir(parents=True, exist_ok=False)
    container_name = _container_name(run_id, agent_id)
    command = [
        "docker",
        "run",
        "--rm",
        "--name",
        container_name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "64",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--env",
        "HOME=/tmp",
        "--env",
        "LANG=C.UTF-8",
        "--env",
        "PATH=/usr/bin:/bin",
        "--env",
        "TMPDIR=/tmp",
        "--volume",
        f"{solver.resolve()}:/submission/solver.sh:ro",
        "--volume",
        f"{input_root.resolve()}:/input:ro",
        "--volume",
        f"{output_root.resolve()}:/output:rw",
        "--entrypoint",
        "/bin/sh",
        image_id,
        "/submission/solver.sh",
        "/input",
        "/output",
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        _remove_container(container_name)
        shutil.rmtree(output_root)
        raise TimeoutError(
            f"Clean solver exceeded its {timeout_seconds:g}-second deadline."
        ) from error

    try:
        outputs = _outputs(output_root)
        output_paths = tuple(output["path"] for output in outputs)
        if output_paths != EXPECTED_OUTPUTS:
            raise ValueError(
                f"Solver output set must be exactly {EXPECTED_OUTPUTS}, received {output_paths}."
            )
    except ValueError:
        shutil.rmtree(output_root)
        raise

    reconstruction_path = output_root / "reconstruction.txt"
    reconstruction = reconstruction_path.read_bytes()
    solver_bytes = solver.read_bytes()
    return {
        "schemaVersion": 1,
        "contractId": "solver-execution",
        "runId": run_id,
        "executionId": f"{agent_id}-clean-solver-001",
        "bundle": _artifact(solver_bytes, "solver-executable"),
        "networkDisabled": True,
        "exitCode": completed.returncode,
        "outputs": outputs,
        "targetByteMatch": reconstruction == target,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()
    target = (args.bundle / "sealed/prepared.txt").read_bytes()
    grading = args.attempt / "grading"
    input_roots = stage_solver_inputs(args.run_id, args.attempt)
    executions = []
    for agent_number in range(1, 4):
        agent_id = f"agent-{agent_number}"
        executions.append(
            execute_solver(
                run_id=args.run_id,
                agent_id=agent_id,
                solver=args.attempt / "agents" / agent_id / "private-output" / "solver.sh",
                input_root=input_roots[agent_id],
                output_root=grading / "solver-output" / agent_id,
                target=target,
            )
        )
    output = grading / "solver-executions.json"
    output.write_bytes(canonical_json_bytes(executions))
    print(canonical_json_bytes(executions).decode())


if __name__ == "__main__":
    main()
