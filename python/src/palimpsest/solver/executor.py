from __future__ import annotations

import argparse
import subprocess
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex


def _artifact(content: bytes, artifact_type: str) -> dict[str, Any]:
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _outputs(root: Path) -> list[dict[str, Any]]:
    result = []
    for path in sorted(
        (candidate for candidate in root.rglob("*") if candidate.is_file()),
        key=lambda candidate: candidate.relative_to(root).as_posix(),
    ):
        content = path.read_bytes()
        result.append(
            {
                "path": path.relative_to(root).as_posix(),
                "byteLength": len(content),
                "sha256": sha256_hex(content),
            }
        )
    return result


def execute_solver(
    *,
    run_id: str,
    agent_id: str,
    solver: Path,
    input_root: Path,
    output_root: Path,
    target: bytes,
    timeout_seconds: float = 10,
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=False)
    profile = "(version 1)(allow default)(deny network*)"
    command = [
        "/usr/bin/sandbox-exec",
        "-p",
        profile,
        str(solver),
        str(input_root),
        str(output_root),
    ]
    environment = {
        "HOME": str(output_root),
        "LANG": "C.UTF-8",
        "PATH": "/usr/bin:/bin",
        "TMPDIR": str(output_root),
    }
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        env=environment,
        timeout=timeout_seconds,
    )
    outputs = _outputs(output_root)
    reconstruction_path = output_root / "reconstruction.txt"
    reconstruction = reconstruction_path.read_bytes() if reconstruction_path.is_file() else b""
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
