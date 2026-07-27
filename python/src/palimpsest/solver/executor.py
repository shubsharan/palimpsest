from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
IMAGE_LOCK = REPOSITORY_ROOT / "containers/images.lock.json"
EXPECTED_OUTPUTS = ("reconstruction.txt",)
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
    input_root = grading / "solver-input"
    input_root.mkdir(parents=True, exist_ok=True)
    (input_root / "candidate.txt").write_bytes(
        (args.bundle / "private/agent-1/chapters/010.txt").read_bytes()
    )
    executions = []
    for agent_number in range(1, 4):
        agent_id = f"agent-{agent_number}"
        executions.append(
            execute_solver(
                run_id=args.run_id,
                agent_id=agent_id,
                solver=args.attempt / "agents" / agent_id / "private-output" / "solver.sh",
                input_root=input_root,
                output_root=grading / "solver-output" / agent_id,
                target=target,
            )
        )
    output = grading / "solver-executions.json"
    output.write_bytes(canonical_json_bytes(executions))
    print(canonical_json_bytes(executions).decode())


if __name__ == "__main__":
    main()
