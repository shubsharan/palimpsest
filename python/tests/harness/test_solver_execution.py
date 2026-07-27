from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
from palimpsest.solver import executor

IMAGE_ID = f"sha256:{'a' * 64}"


def _image_lock(path: Path) -> Path:
    lock = path / "images.lock.json"
    lock.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "cleanSolver": {
                    "tag": "palimpsest-clean-solver:test",
                    "imageId": IMAGE_ID,
                },
            }
        ),
        encoding="utf-8",
    )
    return lock


def _mount(command: list[str], destination: str) -> Path:
    volumes = [command[index + 1] for index, value in enumerate(command) if value == "--volume"]
    source = next(volume for volume in volumes if volume.endswith(f":{destination}"))
    return Path(source.split(":", maxsplit=1)[0])


def _fixture(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    solver = tmp_path / "solver.sh"
    solver.write_text(
        '#!/bin/sh\nset -eu\ncp "$1/candidate.txt" "$2/reconstruction.txt"\n',
        encoding="utf-8",
    )
    input_root = tmp_path / "input"
    input_root.mkdir()
    target = b"containerized reconstruction\n"
    (input_root / "candidate.txt").write_bytes(target)
    output_root = tmp_path / "output"
    return solver, input_root, output_root, _image_lock(tmp_path)


def test_executes_non_python_solver_with_locked_network_and_mounts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    solver, input_root, output_root, image_lock = _fixture(tmp_path)
    commands: list[list[str]] = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes | str]:
        commands.append(command)
        if command[1:3] == ["image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, stdout=f"{IMAGE_ID}\n", stderr="")
        mounted_input = _mount(command, "/input:ro")
        mounted_output = _mount(command, "/output:rw")
        (mounted_output / "reconstruction.txt").write_bytes(
            (mounted_input / "candidate.txt").read_bytes()
        )
        return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(executor.subprocess, "run", fake_run)
    record = executor.execute_solver(
        run_id="run-001",
        agent_id="agent-1",
        solver=solver,
        input_root=input_root,
        output_root=output_root,
        target=(input_root / "candidate.txt").read_bytes(),
        image_lock=image_lock,
    )

    command = commands[1]
    assert command[command.index("--network") + 1] == "none"
    assert "--read-only" in command
    assert command[command.index("--cap-drop") + 1] == "ALL"
    assert command[command.index("--security-opt") + 1] == "no-new-privileges"
    assert command[command.index("--entrypoint") + 1] == "/bin/sh"
    assert command[-4:] == [IMAGE_ID, "/submission/solver.sh", "/input", "/output"]
    assert record["networkDisabled"] is True
    assert record["exitCode"] == 0
    assert record["targetByteMatch"] is True
    assert record["outputs"] == [
        {
            "path": "reconstruction.txt",
            "byteLength": len((input_root / "candidate.txt").read_bytes()),
            "sha256": executor.sha256_hex((input_root / "candidate.txt").read_bytes()),
        }
    ]


def test_timeout_removes_container_and_untrusted_outputs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    solver, input_root, output_root, image_lock = _fixture(tmp_path)
    commands: list[list[str]] = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes | str]:
        commands.append(command)
        if command[1:3] == ["image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, stdout=f"{IMAGE_ID}\n", stderr="")
        if command[1:3] == ["rm", "--force"]:
            return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")
        output_root.joinpath("partial.txt").write_text("partial\n", encoding="utf-8")
        raise subprocess.TimeoutExpired(command, 0.01)

    monkeypatch.setattr(executor.subprocess, "run", fake_run)
    with pytest.raises(TimeoutError, match="deadline"):
        executor.execute_solver(
            run_id="run-001",
            agent_id="agent-1",
            solver=solver,
            input_root=input_root,
            output_root=output_root,
            target=b"",
            timeout_seconds=0.01,
            image_lock=image_lock,
        )

    assert commands[-1][1:3] == ["rm", "--force"]
    assert not output_root.exists()


def test_rejects_undeclared_output_set(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    solver, input_root, output_root, image_lock = _fixture(tmp_path)

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[bytes | str]:
        if command[1:3] == ["image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, stdout=f"{IMAGE_ID}\n", stderr="")
        output_root.joinpath("reconstruction.txt").write_text("candidate\n", encoding="utf-8")
        output_root.joinpath("undeclared.txt").write_text("undeclared\n", encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

    monkeypatch.setattr(executor.subprocess, "run", fake_run)
    with pytest.raises(ValueError, match="output set"):
        executor.execute_solver(
            run_id="run-001",
            agent_id="agent-1",
            solver=solver,
            input_root=input_root,
            output_root=output_root,
            target=b"",
            image_lock=image_lock,
        )

    assert not output_root.exists()


def test_refuses_image_identity_drift_before_execution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    solver, input_root, output_root, image_lock = _fixture(tmp_path)

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=f"sha256:{'b' * 64}\n",
            stderr="",
        )

    monkeypatch.setattr(executor.subprocess, "run", fake_run)
    with pytest.raises(RuntimeError, match="identity mismatch"):
        executor.execute_solver(
            run_id="run-001",
            agent_id="agent-1",
            solver=solver,
            input_root=input_root,
            output_root=output_root,
            target=b"",
            image_lock=image_lock,
        )

    assert not output_root.exists()


@pytest.mark.skipif(
    os.environ.get("PALIMPSEST_CONTAINER_TESTS") != "1",
    reason="set PALIMPSEST_CONTAINER_TESTS=1 to exercise the pinned Docker image",
)
def test_real_clean_solver_container_executes_without_python(tmp_path: Path) -> None:
    solver, input_root, output_root, _ = _fixture(tmp_path)
    solver.write_text(
        """#!/bin/sh
set -eu
if printf tamper >> "$1/candidate.txt" 2>/dev/null; then
  exit 97
fi
if node -e '
const net = require("node:net");
const socket = net.connect(80, "1.1.1.1");
socket.setTimeout(250);
socket.on("connect", () => process.exit(0));
socket.on("error", () => process.exit(1));
socket.on("timeout", () => process.exit(1));
'; then
  exit 98
fi
cp "$1/candidate.txt" "$2/reconstruction.txt"
""",
        encoding="utf-8",
    )
    target = (input_root / "candidate.txt").read_bytes()

    record = executor.execute_solver(
        run_id="container-test",
        agent_id="agent-1",
        solver=solver,
        input_root=input_root,
        output_root=output_root,
        target=target,
    )

    assert record["exitCode"] == 0
    assert record["targetByteMatch"] is True
    assert (output_root / "reconstruction.txt").read_bytes() == target
