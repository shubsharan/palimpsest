from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value
from palimpsest.grading.score_report import METRIC_IDS

FORBIDDEN_MARKERS = {
    "api_key",
    "credential",
    "middlemarch",
    "oracle",
    "prepared-plaintext",
    "private-output",
    "revised-key",
    "stationary-key",
}


def _write_json(root: Path, path: str, value: Any) -> None:
    destination = root / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(canonical_json_bytes(value))


def _artifact(path: Path, artifact_type: str) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _sanitized_events(path: Path) -> list[dict[str, Any]]:
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line:
            continue
        event = json.loads(line)
        events.append(
            {
                "sequence": event["sequence"],
                "eventType": event["eventType"],
                "producer": event["producer"],
            }
        )
    return events


def _metric_plot(metrics: dict[str, float]) -> str:
    width = 720
    row_height = 28
    height = 36 + row_height * len(metrics)
    rows = []
    for index, (name, value) in enumerate(metrics.items()):
        y = 28 + index * row_height
        bar_width = round(value * 440, 3)
        rows.append(
            f'<text x="8" y="{y}" font-size="12">{name}</text>'
            f'<rect x="150" y="{y - 12}" width="{bar_width}" height="14" fill="#176b87"/>'
            f'<text x="600" y="{y}" font-size="12">{value:.3f}</text>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="#f4f0e6"/>'
        f"{''.join(rows)}</svg>"
    )


def _assert_same_tree(left: Path, right: Path) -> None:
    left_files = sorted(path.relative_to(left) for path in left.rglob("*") if path.is_file())
    right_files = sorted(path.relative_to(right) for path in right.rglob("*") if path.is_file())
    if left_files != right_files:
        raise ValueError("Repeated public report changed its exact output set.")
    for path in left_files:
        if (left / path).read_bytes() != (right / path).read_bytes():
            raise ValueError(f"Repeated public report changed bytes: {path.as_posix()}")


def build_public_report(run_id: str, attempt: Path, root: Path = Path(".")) -> dict[str, Any]:
    replay = json.loads((attempt / "replay/verdict.json").read_text(encoding="utf-8"))
    if (
        replay.get("runId") != run_id
        or replay.get("result") != "pass"
        or not isinstance(replay.get("replayDigest"), str)
    ):
        raise ValueError("Public report requires a passing replay for the same run.")
    score = json.loads((attempt / "grading/score-report.json").read_text(encoding="utf-8"))
    verdict = validate_value("score-report", score)
    if not verdict.accepted or score.get("runId") != run_id:
        raise ValueError("Public report requires a valid score report for the same run.")
    raw_metrics = score["metrics"]
    if set(raw_metrics) != set(METRIC_IDS) or any(
        not isinstance(value, int | float) or isinstance(value, bool) or not 0 <= value <= 1
        for value in raw_metrics.values()
    ):
        raise ValueError("Public metrics do not match the frozen scoring policy.")
    metrics = {metric_id: raw_metrics[metric_id] for metric_id in METRIC_IDS}

    public_root = attempt / "public"
    public_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".public-", dir=public_root.parent))
    try:
        _write_json(staging, "metrics.json", metrics)
        _write_json(staging, "events.json", _sanitized_events(attempt / "live.jsonl"))
        _write_json(
            staging,
            "implementation.json",
            {
                "schemaVersion": 1,
                "status": "offline-harness-verification",
                "completedComponents": ["generation", "collaboration", "grading", "replay"],
                "externalModelRequestCount": 0,
            },
        )
        _write_json(
            staging,
            "environment.json",
            {
                "schemaVersion": 1,
                "toolVersions": (root / ".tool-versions").read_text(encoding="utf-8").splitlines(),
            },
        )
        _write_json(
            staging,
            "claims.json",
            {
                "schemaVersion": 1,
                "scope": "implementation-correctness-only",
                "empiricalModelEvidence": False,
                "liveModelValidationAuthorized": False,
            },
        )
        plot = staging / "plots/aggregate-metrics.svg"
        plot.parent.mkdir(parents=True)
        plot.write_text(_metric_plot(metrics), encoding="utf-8")
        artifact_paths = [
            ("metrics.json", "aggregate-score-report"),
            ("events.json", "sanitized-event-trace"),
            ("implementation.json", "implementation-status"),
            ("environment.json", "environment-versions"),
            ("claims.json", "claim-scope"),
            ("plots/aggregate-metrics.svg", "aggregate-score-plot"),
        ]
        report = {
            "schemaVersion": 1,
            "contractId": "public-report-bundle",
            "runId": run_id,
            "replayDigest": replay["replayDigest"],
            "artifacts": [
                _artifact(staging / path, artifact_type) for path, artifact_type in artifact_paths
            ],
            "empiricalModelEvidence": False,
        }
        verdict = validate_value("public-report-bundle", report)
        if not verdict.accepted:
            raise ValueError(f"Public report is invalid: {verdict.reason} at {verdict.pointer}")
        _write_json(staging, "report.json", report)
        public_text = "\n".join(
            path.read_text(encoding="utf-8") for path in staging.rglob("*") if path.is_file()
        ).casefold()
        leaked = sorted(marker for marker in FORBIDDEN_MARKERS if marker in public_text)
        if leaked:
            raise ValueError(f"Public report contains forbidden markers: {leaked}")
        if public_root.exists():
            _assert_same_tree(public_root, staging)
            shutil.rmtree(staging)
        else:
            os.replace(staging, public_root)
        return report
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
