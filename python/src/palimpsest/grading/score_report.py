from __future__ import annotations

import argparse
import json
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from palimpsest.contracts import canonical_json_bytes
from palimpsest.generation.text import word_tokens

POLICY_ID = "palimpsest-score-v1"
METRIC_IDS = (
    "reconstruction",
    "entity",
    "dictionary",
    "changed",
    "stable",
    "switch",
    "latency",
    "collaboration",
    "confidence",
)


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _bounded(value: float) -> float:
    return round(min(1.0, max(0.0, value)), 12)


def _token_similarity(candidate: str, target: str) -> float:
    candidate_tokens = [token.normalized for token in word_tokens(candidate)]
    target_tokens = [token.normalized for token in word_tokens(target)]
    return SequenceMatcher(None, candidate_tokens, target_tokens, autojunk=False).ratio()


def _mapping_accuracy(mapping: dict[str, str], pairs: list[tuple[str, str]]) -> float:
    return _mean([1.0 if mapping.get(cipher) == plain else 0.0 for cipher, plain in pairs])


def _parse_mapping(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or any(
        not isinstance(cipher, str) or not isinstance(plain, str) for cipher, plain in value.items()
    ):
        raise ValueError("Submitted mapping must be an object of cipher-to-plaintext strings.")
    return value


def _parse_hypothesis(value: Any) -> tuple[bool, float | None]:
    if not isinstance(value, dict) or not isinstance(value.get("switchDetected"), bool):
        raise ValueError("Submitted hypothesis must declare switchDetected as a boolean.")
    confidence = value.get("confidence")
    if confidence is not None and (
        not isinstance(confidence, int | float)
        or isinstance(confidence, bool)
        or not 0 <= confidence <= 1
    ):
        raise ValueError("Submitted confidence must be between zero and one.")
    return value["switchDetected"], float(confidence) if confidence is not None else None


def score_metrics(
    *,
    target: str,
    candidates: list[str],
    mappings: list[dict[str, str]],
    hypotheses: list[dict[str, Any]],
    stationary_key: dict[str, str],
    changed_entries: list[dict[str, Any]],
    matched_controls: list[dict[str, Any]],
    entity_types: set[str],
    events: list[dict[str, Any]],
    ledgers: list[dict[str, Any]],
    agent_ids: tuple[str, ...],
) -> dict[str, float]:
    if not (len(candidates) == len(mappings) == len(hypotheses) == len(agent_ids)):
        raise ValueError(
            "Scoring inputs must contain one candidate, mapping, and hypothesis per agent."
        )
    dictionary_pairs = [(cipher, plain) for plain, cipher in sorted(stationary_key.items())]
    entity_pairs = [
        (cipher, plain) for plain, cipher in sorted(stationary_key.items()) if plain in entity_types
    ]
    changed_pairs = [(entry["revisedCipherType"], entry["plainType"]) for entry in changed_entries]
    stable_pairs = [(entry["cipherType"], entry["plainType"]) for entry in matched_controls]
    switch_expected = bool(changed_entries)

    reconstruction_scores = [_token_similarity(candidate, target) for candidate in candidates]
    entity_scores = [_mapping_accuracy(mapping, entity_pairs) for mapping in mappings]
    dictionary_scores = [_mapping_accuracy(mapping, dictionary_pairs) for mapping in mappings]
    changed_scores = [_mapping_accuracy(mapping, changed_pairs) for mapping in mappings]
    stable_scores = [_mapping_accuracy(mapping, stable_pairs) for mapping in mappings]
    parsed_hypotheses = [_parse_hypothesis(value) for value in hypotheses]
    switch_scores = [
        1.0 if detected is switch_expected else 0.0 for detected, _ in parsed_hypotheses
    ]

    submitted_times = [
        int(event["monotonicElapsedNs"])
        for event in events
        if event.get("eventType") == "lifecycle.transition"
        and event.get("payload", {}).get("state") == "SUBMITTED"
    ]
    completion_times = {
        event.get("payload", {}).get("agentId"): int(event["monotonicElapsedNs"])
        for event in events
        if event.get("eventType") == "worker.completed"
    }
    if len(submitted_times) != 1 or any(agent_id not in completion_times for agent_id in agent_ids):
        raise ValueError(
            "Latency scoring requires one submission event and one completion per agent."
        )
    submitted_time = submitted_times[0]
    if submitted_time <= 0:
        raise ValueError("Submission monotonic time must be positive.")
    latency_scores = [1.0 - completion_times[agent_id] / submitted_time for agent_id in agent_ids]

    accepted_agents = {
        entry.get("agentId") for entry in ledgers if entry.get("result") == "accepted"
    }
    collaboration = sum(agent_id in accepted_agents for agent_id in agent_ids) / len(agent_ids)

    confidence_scores = []
    for index, (_, confidence) in enumerate(parsed_hypotheses):
        if confidence is None:
            continue
        observed = _mean(
            [
                reconstruction_scores[index],
                dictionary_scores[index],
                changed_scores[index],
                stable_scores[index],
                switch_scores[index],
            ]
        )
        confidence_scores.append(1.0 - abs(confidence - observed))

    values = {
        "reconstruction": _mean(reconstruction_scores),
        "entity": _mean(entity_scores),
        "dictionary": _mean(dictionary_scores),
        "changed": _mean(changed_scores),
        "stable": _mean(stable_scores),
        "switch": _mean(switch_scores),
        "latency": _mean(latency_scores),
        "collaboration": collaboration,
        "confidence": _mean(confidence_scores),
    }
    return {metric_id: _bounded(values[metric_id]) for metric_id in METRIC_IDS}


def build_score_report(run_id: str, attempt: Path, bundle: Path) -> dict[str, object]:
    agent_ids = ("agent-1", "agent-2", "agent-3")
    candidates = []
    mappings = []
    hypotheses = []
    for agent_id in agent_ids:
        private = attempt / "agents" / agent_id / "private-output"
        candidates.append(
            (attempt / "grading" / "solver-output" / agent_id / "reconstruction.txt").read_text(
                encoding="utf-8"
            )
        )
        mappings.append(
            _parse_mapping(json.loads((private / "mapping.json").read_text(encoding="utf-8")))
        )
        hypotheses.append(json.loads((private / "hypothesis.json").read_text(encoding="utf-8")))
    events = [
        json.loads(line)
        for line in (attempt / "live.jsonl").read_text(encoding="utf-8").splitlines()
        if line
    ]
    metrics = score_metrics(
        target=(bundle / "sealed/prepared.txt").read_text(encoding="utf-8"),
        candidates=candidates,
        mappings=mappings,
        hypotheses=hypotheses,
        stationary_key=json.loads(
            (bundle / "sealed/stationary-key.json").read_text(encoding="utf-8")
        ),
        changed_entries=json.loads(
            (bundle / "sealed/changed-entries.json").read_text(encoding="utf-8")
        ),
        matched_controls=json.loads(
            (bundle / "sealed/matched-controls.json").read_text(encoding="utf-8")
        ),
        entity_types=set(
            json.loads((bundle / "sealed/entity-types.json").read_text(encoding="utf-8"))
        ),
        events=events,
        ledgers=json.loads((attempt / "git/ledgers.json").read_text(encoding="utf-8")),
        agent_ids=agent_ids,
    )
    return {
        "schemaVersion": 1,
        "contractId": "score-report",
        "runId": run_id,
        "policyId": POLICY_ID,
        "metrics": metrics,
    }


def score_attempt(run_id: str, attempt: Path, bundle: Path) -> dict[str, object]:
    report = build_score_report(run_id, attempt, bundle)
    (attempt / "grading" / "score-report.json").write_bytes(canonical_json_bytes(report))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    args = parser.parse_args()
    print(canonical_json_bytes(score_attempt(args.run_id, args.attempt, args.bundle)).decode())


if __name__ == "__main__":
    main()
