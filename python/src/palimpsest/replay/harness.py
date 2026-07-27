from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes, sha256_hex, validate_value
from palimpsest.grading.score_report import build_score_report


def _artifact(path: Path, artifact_type: str) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "artifactType": artifact_type,
        "byteLength": len(content),
        "sha256": sha256_hex(content),
    }


def _json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validate(contract_id: str, value: Any) -> None:
    verdict = validate_value(contract_id, value)
    if not verdict.accepted:
        raise ValueError(f"{contract_id} is invalid: {verdict.reason} at {verdict.pointer}")


def _verify_events(path: Path, run_id: str) -> tuple[list[dict[str, Any]], str]:
    previous = None
    effects: set[str] = set()
    events = []
    for sequence, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        event = json.loads(line)
        _validate("run-event", event)
        if (
            event["runId"] != run_id
            or event["sequence"] != sequence
            or event["previousDigest"] != previous
            or event["effectId"] in effects
        ):
            raise ValueError("Run event identity, order, predecessor, or effect ID is invalid.")
        digest = event.pop("digest")
        if sha256_hex(canonical_json_bytes(event)) != digest:
            raise ValueError("Run event digest mismatch.")
        event["digest"] = digest
        previous = digest
        effects.add(event["effectId"])
        events.append(event)
    if previous is None:
        raise ValueError("Run event stream is empty.")
    return events, previous


def _verify_git_bundle(path: Path, freeze: dict[str, Any]) -> None:
    content = path.read_bytes()
    reference = freeze["gitBundle"]
    if len(content) != reference["byteLength"] or sha256_hex(content) != reference["sha256"]:
        raise ValueError("Frozen Git bundle does not match its artifact reference.")
    subprocess.run(["git", "bundle", "verify", str(path)], check=True, capture_output=True)
    heads = subprocess.run(
        ["git", "bundle", "list-heads", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    refs = {
        reference_name: object_id
        for object_id, reference_name in (line.split(maxsplit=1) for line in heads)
        if reference_name.startswith("refs/")
    }
    if sha256_hex(canonical_json_bytes(refs)) != freeze["refMapDigest"]:
        raise ValueError("Frozen Git refs do not match the declared ref-map digest.")


def _verify_ledgers(entries: list[dict[str, Any]], freeze: dict[str, Any], run_id: str) -> None:
    if sha256_hex(canonical_json_bytes(entries)) != freeze["ledgerDigest"]:
        raise ValueError("Ledger digest does not match the freeze snapshot.")
    remaining: dict[str, int] = {}
    transactions: set[str] = set()
    for entry in entries:
        _validate("push-ledger-entry", entry)
        if entry["runId"] != run_id or entry["transactionId"] in transactions:
            raise ValueError("Ledger run identity or transaction uniqueness is invalid.")
        prior = remaining.get(entry["agentId"], entry["budgetBefore"])
        expected_after = (
            entry["budgetBefore"] - entry["chargeBytes"]
            if entry["result"] == "accepted"
            else entry["budgetBefore"]
        )
        if prior != entry["budgetBefore"] or expected_after != entry["budgetAfter"]:
            raise ValueError("Ledger cumulative budget transition is invalid.")
        remaining[entry["agentId"]] = entry["budgetAfter"]
        transactions.add(entry["transactionId"])


def _verify_submissions(
    attempt: Path, submissions: list[dict[str, Any]], run_id: str, freeze_id: str
) -> None:
    agents: set[str] = set()
    for submission in submissions:
        _validate("private-deliverable-manifest", submission)
        agent_id = submission["agentId"]
        if (
            submission["runId"] != run_id
            or submission["freezeId"] != freeze_id
            or agent_id in agents
        ):
            raise ValueError("Private submission identity is invalid.")
        root = attempt / "agents" / agent_id / "private-output"
        actual = []
        for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
            if path.name == "manifest.json":
                continue
            content = path.read_bytes()
            actual.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "byteLength": len(content),
                    "sha256": sha256_hex(content),
                }
            )
        if canonical_json_bytes(actual) != canonical_json_bytes(submission["outputs"]):
            raise ValueError("Private submission exact output set does not match sealed files.")
        agents.add(agent_id)
    if agents != {"agent-1", "agent-2", "agent-3"}:
        raise ValueError("Replay requires exactly the three declared private submissions.")


def _verify_solver_executions(attempt: Path, executions: list[dict[str, Any]], run_id: str) -> None:
    if len(executions) != 3:
        raise ValueError("Replay requires exactly three clean-solver executions.")
    agents: set[str] = set()
    for execution in executions:
        _validate("solver-execution", execution)
        if execution["runId"] != run_id:
            raise ValueError("Solver execution run identity mismatch.")
        agent_id = execution["executionId"].removesuffix("-clean-solver-001")
        if agent_id in agents:
            raise ValueError("Clean-solver execution agent identity is duplicated.")
        agents.add(agent_id)
        root = attempt / "grading" / "solver-output" / agent_id
        actual = [
            {
                "path": path.relative_to(root).as_posix(),
                "byteLength": len(content := path.read_bytes()),
                "sha256": sha256_hex(content),
            }
            for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file())
        ]
        if canonical_json_bytes(actual) != canonical_json_bytes(execution["outputs"]):
            raise ValueError("Clean-solver exact output set does not match execution evidence.")
    if agents != {"agent-1", "agent-2", "agent-3"}:
        raise ValueError("Replay requires one clean-solver execution per declared agent.")


def replay_attempt(
    run_id: str, attempt: Path, bundle: Path = Path("artifacts/harness/declared")
) -> dict[str, Any]:
    run_manifest = _json(attempt / "run-manifest.json")
    _validate("run-manifest", run_manifest)
    if run_manifest["runId"] != run_id:
        raise ValueError("Run manifest identity mismatch.")
    events, event_head = _verify_events(attempt / "live.jsonl", run_id)
    freeze_path = attempt / "git/freeze.json"
    freeze = _json(freeze_path)
    _validate("freeze-snapshot", freeze)
    if freeze["runId"] != run_id:
        raise ValueError("Freeze run identity mismatch.")
    sequence = freeze["finalEventSequence"]
    if (
        sequence < 1
        or sequence > len(events)
        or events[sequence - 1]["digest"] != freeze["eventChainHead"]
    ):
        raise ValueError("Freeze event-chain identity does not match the sealed event prefix.")
    _verify_git_bundle(attempt / "git/frozen.bundle", freeze)

    publication = _json(attempt / "git/publication.json")
    _validate("published-snapshot", publication)
    if (
        publication["runId"] != run_id
        or publication["refMapDigest"] != freeze["refMapDigest"]
        or publication["visibilityJournalDigest"] != freeze["visibilityJournalDigest"]
        or publication["eventSequence"] >= freeze["finalEventSequence"]
    ):
        raise ValueError("Published snapshot does not reconcile with the freeze snapshot.")
    ledgers = _json(attempt / "git/ledgers.json")
    _verify_ledgers(ledgers, freeze, run_id)
    submissions = _json(attempt / "submissions.json")
    _verify_submissions(attempt, submissions, run_id, freeze["freezeId"])
    executions = _json(attempt / "grading/solver-executions.json")
    _verify_solver_executions(attempt, executions, run_id)

    recorded_score = _json(attempt / "grading/score-report.json")
    _validate("score-report", recorded_score)
    rebuilt_score = build_score_report(run_id, attempt, bundle)
    if canonical_json_bytes(recorded_score) != canonical_json_bytes(rebuilt_score):
        raise ValueError("Recorded score report does not match deterministic replay.")

    artifact_paths = [
        ("run-manifest.json", "run-manifest"),
        ("live.jsonl", "run-event-stream"),
        ("git/publication.json", "published-snapshot"),
        ("git/ledgers.json", "git-ledgers"),
        ("git/freeze.json", "freeze-snapshot"),
        ("git/frozen.bundle", "git-bundle"),
        ("submissions.json", "private-submissions"),
        ("grading/solver-executions.json", "solver-executions"),
        ("grading/score-report.json", "score-report"),
    ]
    replay = {
        "schemaVersion": 1,
        "contractId": "trusted-replay-bundle",
        "runId": run_id,
        "freezeId": freeze["freezeId"],
        "artifacts": [
            _artifact(attempt / path, artifact_type) for path, artifact_type in artifact_paths
        ],
    }
    replay_path = attempt / "replay/trusted-replay.json"
    replay_path.parent.mkdir(parents=True, exist_ok=True)
    replay_path.write_bytes(canonical_json_bytes(replay))
    verdict_record = {
        "schemaVersion": 1,
        "runId": run_id,
        "eventChainHead": event_head,
        "freezeId": freeze["freezeId"],
        "replayDigest": sha256_hex(canonical_json_bytes(replay)),
        "result": "pass",
    }
    (attempt / "replay/verdict.json").write_bytes(canonical_json_bytes(verdict_record))
    return verdict_record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, default=Path("artifacts/harness/declared"))
    args = parser.parse_args()
    replay = replay_attempt(args.run_id, args.attempt, args.bundle)
    from .public_report import build_public_report

    public = build_public_report(args.run_id, args.attempt)
    print(canonical_json_bytes({"replay": replay, "public": public}).decode())


if __name__ == "__main__":
    main()
