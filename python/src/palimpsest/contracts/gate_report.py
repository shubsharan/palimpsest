from __future__ import annotations

import argparse
import json
from typing import Any

from .gate_report_core import predeclaration_digest, predeclaration_projection
from .validation import ValidationVerdict, validate_value


def validate_gate_report(report: dict[str, Any]) -> ValidationVerdict:
    return validate_value("gate-report", report)


def complete_gate_report(
    predeclared: dict[str, Any],
    completion: dict[str, Any],
) -> dict[str, Any]:
    verdict = validate_gate_report(predeclared)
    if not verdict.accepted or predeclared.get("state") != "predeclared":
        raise ValueError("Only a valid predeclared gate report can be completed.")
    return {
        **completion,
        **predeclaration_projection(predeclared),
        "state": "completed",
        "predeclarationDigest": predeclaration_digest(predeclared),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predeclaration-digest")
    args = parser.parse_args()
    if args.predeclaration_digest is None:
        parser.error("--predeclaration-digest is required")
    print(predeclaration_digest(json.loads(args.predeclaration_digest)))


if __name__ == "__main__":
    main()
