from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex


def build_public_report(run_id: str, attempt: Path) -> dict[str, Any]:
    replay = json.loads((attempt / "replay/verdict.json").read_text())
    score_path = attempt / "grading/score-report.json"
    score = json.loads(score_path.read_text())
    report = {
        "schemaVersion": 1,
        "contractId": "public-report-bundle",
        "runId": run_id,
        "replayDigest": replay["replayDigest"],
        "artifacts": [
            {
                "artifactType": "aggregate-score-report",
                "byteLength": score_path.stat().st_size,
                "sha256": sha256_hex(score_path.read_bytes()),
            }
        ],
        "empiricalModelEvidence": False,
    }
    public_root = attempt / "public"
    public_root.mkdir(parents=True, exist_ok=True)
    (public_root / "report.json").write_bytes(canonical_json_bytes(report))
    (public_root / "metrics.json").write_bytes(canonical_json_bytes(score["metrics"]))
    forbidden = {
        "prepared",
        "stationary",
        "revised",
        "private",
        "credential",
        "middlemarch",
    }
    public_text = "\n".join(
        path.read_text(encoding="utf-8") for path in public_root.rglob("*") if path.is_file()
    ).casefold()
    leaked = sorted(marker for marker in forbidden if marker in public_text)
    if leaked:
        raise ValueError(f"Public report contains forbidden markers: {leaked}")
    return report
