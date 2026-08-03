from __future__ import annotations

import json
import math
import sys
from io import TextIOWrapper
from pathlib import Path

import pytest
from palimpsest.evaluation.process import decode_request, main, process_request
from palimpsest.serialization import canonical_json_bytes


def trace_ref(sequence: int) -> dict[str, object]:
    return {
        "source": "trace",
        "traceSequence": sequence,
        "excerptDigest": f"{sequence:064x}",
        "role": "support",
    }


def event(
    sequence: int,
    at_ms: float,
    kind: str,
    data: dict[str, object],
    *,
    actor_id: str | None = None,
    origin_id: str = "shared",
) -> dict[str, object]:
    value: dict[str, object] = {
        "sequence": sequence,
        "atMs": at_ms,
        "kind": kind,
        "originId": origin_id,
        "data": data,
        "evidence": trace_ref(sequence),
    }
    if actor_id is not None:
        value["actorId"] = actor_id
    return value


def measure_request() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "kind": "measure",
        "communicationMode": "shared",
        "actors": ["actor-1", "actor-2"],
        "origins": [
            {
                "originId": "shared",
                "startedAtMs": 100,
                "endedAtMs": 1_100,
                "outcome": {
                    "runnable": True,
                    "matchedWords": 75,
                    "totalWords": 100,
                    "coverage": 0.8,
                    "accuracy": 0.75,
                    "evidence": [trace_ref(20)],
                },
            }
        ],
        "events": [
            event(1, 100, "stage", {"stageId": "stage-1"}),
            event(2, 140, "response", {}, actor_id="actor-1"),
            event(3, 150, "tool", {"toolName": "shell"}, actor_id="actor-1"),
            event(4, 175, "checker", {}, actor_id="actor-1"),
            event(5, 200, "message", {}, actor_id="actor-1"),
            event(6, 230, "read", {}, actor_id="actor-2"),
            event(7, 300, "message", {}, actor_id="actor-2"),
            event(8, 350, "git", {"refTargetsKnown": True}, actor_id="actor-2"),
            event(
                9,
                400,
                "usage",
                {"inputTokens": 30, "outputTokens": 20},
                actor_id="actor-1",
            ),
            event(10, 1_000, "publication", {"runnable": True}),
            event(11, 1_100, "termination", {"value": "completed"}),
        ],
        "reviews": [
            {
                "reviewerId": "judge-a",
                "revisionOpportunities": [
                    {
                        "episodeId": "revision-1",
                        "status": "supported-revision",
                        "evidence": [trace_ref(2)],
                    },
                    {
                        "episodeId": "revision-2",
                        "status": "missed-revision",
                        "evidence": [trace_ref(4)],
                    },
                ],
                "collaborationOpportunities": [
                    {
                        "episodeId": "collaboration-1",
                        "status": "integrated",
                        "contributionActorId": "actor-1",
                        "uptakeActorId": "actor-2",
                        "contributedAtMs": 200,
                        "uptakeAtMs": 230,
                        "integratedAtMs": 350,
                        "evidence": [trace_ref(5), trace_ref(6), trace_ref(8)],
                    }
                ],
            },
            {
                "reviewerId": "judge-b",
                "revisionOpportunities": [],
                "collaborationOpportunities": [],
            },
        ],
    }


def values_by_id(response: dict[str, object]) -> dict[str, dict[str, object]]:
    groups = response["measures"]
    assert isinstance(groups, list) and len(groups) == 1
    group = groups[0]
    assert isinstance(group, dict)
    values = group["values"]
    assert isinstance(values, list)
    return {str(value["measureId"]): value for value in values if isinstance(value, dict)}


@pytest.mark.contract
def test_measure_contract_is_strict_finite_and_canonical(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    request = measure_request()
    decoded = decode_request(request)
    response = process_request(decoded)

    assert response["schemaVersion"] == 1
    assert response["kind"] == "measure"
    canonical = canonical_json_bytes(response)
    assert canonical_json_bytes(json.loads(canonical)) == canonical

    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(request), encoding="utf-8")
    monkeypatch.setattr(
        sys, "argv", ["palimpsest.evaluation.process", "--request", str(request_path)]
    )
    main()
    output = capsys.readouterr().out
    assert output.encode() == canonical_json_bytes(response) + b"\n"

    request["unexpected"] = True
    with pytest.raises(ValueError, match="exactly"):
        decode_request(request)
    request.pop("unexpected")
    request["origins"][0]["startedAtMs"] = math.inf  # type: ignore[index]
    with pytest.raises(ValueError, match="finite"):
        decode_request(request)


@pytest.mark.contract
def test_measure_contract_enforces_denominators_and_missingness() -> None:
    request = measure_request()
    request["origins"][0]["outcome"] = {  # type: ignore[index]
        "matchedWords": 2,
        "totalWords": 0,
        "evidence": [trace_ref(20)],
    }
    with pytest.raises(ValueError, match="totalWords"):
        decode_request(request)

    response = process_request(decode_request(measure_request()))
    measures = values_by_id(response)
    ratio = measures["outcome.accuracy.v1"]
    assert ratio["value"] == 0.75
    assert ratio["numerator"] == 75
    assert ratio["denominator"] == 100
    assert ratio["state"] == "observed"
    assert "reason" not in ratio

    missing = measure_request()
    missing["origins"][0]["outcome"] = {"evidence": []}  # type: ignore[index]
    missing["events"] = [
        candidate
        for candidate in missing["events"]  # type: ignore[union-attr]
        if candidate["kind"] != "git"
    ]
    missing_measures = values_by_id(process_request(decode_request(missing)))
    assert missing_measures["outcome.accuracy.v1"] == {
        "measureId": "outcome.accuracy.v1",
        "ledger": "outcome",
        "basis": "mechanical",
        "state": "unavailable",
        "eligibility": {
            "ruleId": "completed-origin-outcome",
            "explanation": (
                "Requires the frozen accuracy and word-count observations for a completed origin."
                " Missingness: Accuracy or word-count evidence is unavailable."
            ),
        },
        "evidence": [],
    }
    assert missing_measures["instrumental.git-ref-trajectory-completeness.v1"]["state"] == (
        "unavailable"
    )


def test_normalized_events_accept_run_record_provenance() -> None:
    request = measure_request()
    usage = request["events"][8]  # type: ignore[index]
    usage["evidence"] = {
        "source": "run-record",
        "recordPointer": "/sessions/0",
        "excerptDigest": "f" * 64,
        "role": "context",
    }

    decoded = decode_request(request)
    assert decoded["events"][8]["evidence"]["source"] == "run-record"


def test_mechanical_metrics_cover_outcome_activity_usage_publication_and_tool_mix() -> None:
    measures = values_by_id(process_request(decode_request(measure_request())))

    assert measures["outcome.runnable.v1"]["value"] is True
    assert measures["outcome.coverage.v1"]["value"] == 0.8
    assert measures["outcome.accuracy.v1"]["value"] == 0.75
    assert measures["instrumental.elapsed-time-ms.v1"]["value"] == 1_000
    assert measures["instrumental.stage-first-action-latency-mean-ms.v1"]["value"] == 40
    assert measures["instrumental.tool-calls.v1"]["value"] == 1
    assert measures["instrumental.tool-mix.shell.v1"]["value"] == 1
    assert measures["instrumental.checker-calls.v1"]["value"] == 1
    assert measures["social.messages-sent.v1"]["value"] == 2
    assert measures["social.messages-read.v1"]["value"] == 1
    assert measures["instrumental.git-change-events.v1"]["value"] == 1
    assert measures["instrumental.input-tokens.v1"]["value"] == 30
    assert measures["instrumental.output-tokens.v1"]["value"] == 20
    assert measures["instrumental.termination.v1"]["value"] == "completed"
    assert measures["instrumental.publication.v1"]["value"] is True
    assert measures["social.participation-balance.v1"]["value"] == 1.0


def test_review_coded_revision_and_collaboration_metrics_preserve_each_judge_basis() -> None:
    measures = values_by_id(process_request(decode_request(measure_request())))

    assert measures["epistemic.supported-revision-rate.judge-a.v1"]["value"] == 0.5
    assert measures["epistemic.supported-revision-rate.judge-a.v1"]["denominator"] == 2
    assert measures["epistemic.supported-revision-rate.judge-b.v1"]["state"] == "unavailable"
    assert measures["social.contribution-uptake-rate.judge-a.v1"]["value"] == 1.0
    assert measures["social.integration-latency-mean-ms.judge-a.v1"]["value"] == 150

    isolated = measure_request()
    isolated["communicationMode"] = "isolated"
    isolated_measures = values_by_id(process_request(decode_request(isolated)))
    assert isolated_measures["social.participation-balance.v1"]["state"] == "not-applicable"
    assert isolated_measures["social.contribution-uptake-rate.judge-a.v1"]["state"] == (
        "not-applicable"
    )


def aggregate_request() -> dict[str, object]:
    def scorecard(
        run_id: str,
        origin_id: str,
        cluster_id: str,
        outcome: float | None,
        process: float | None,
        ratings: tuple[int | None, int | None],
    ) -> dict[str, object]:
        return {
            "runId": run_id,
            "originId": origin_id,
            "clusterId": cluster_id,
            "outcomes": [
                {
                    "measureId": "outcome.word-coverage.v1",
                    "state": "observed" if outcome is not None else "unavailable",
                    **({"value": outcome} if outcome is not None else {"reason": "missing"}),
                }
            ],
            "processMeasures": [
                {
                    "measureId": "epistemic.supported-revision-rate.v1",
                    "state": "observed" if process is not None else "unavailable",
                    **({"value": process} if process is not None else {"reason": "missing"}),
                }
            ],
            "reviews": [
                {
                    "reviewerId": reviewer,
                    "dimensions": [
                        {
                            "dimensionId": "epistemic.testing",
                            "state": "rated" if rating is not None else "unobservable",
                            **({"rating": rating} if rating is not None else {"reason": "missing"}),
                        }
                    ],
                }
                for reviewer, rating in zip(("judge-a", "judge-b"), ratings, strict=True)
            ],
        }

    return {
        "schemaVersion": 1,
        "kind": "aggregate",
        "design": {"experimentalUnit": "origin", "clusterBy": "run"},
        "scorecards": [
            scorecard("run-1", "agent-1", "run-1", 0.2, 0.1, (1, 1)),
            scorecard("run-1", "agent-2", "run-1", 0.4, 0.3, (2, 3)),
            scorecard("run-2", "agent-1", "run-2", 0.8, 0.7, (4, 4)),
            scorecard("run-3", "agent-1", "run-3", None, None, (None, None)),
        ],
    }


def test_aggregation_preserves_distributions_missingness_and_reviewer_agreement() -> None:
    response = process_request(decode_request(aggregate_request()))

    assert response["kind"] == "aggregate"
    dimension = response["dimensions"][0]  # type: ignore[index]
    assert dimension["dimensionId"] == "epistemic.testing"
    assert dimension["distribution"] == [0, 2, 1, 1, 2]
    assert dimension["ratingCount"] == 6
    missingness = response["missingness"][0]  # type: ignore[index]
    assert missingness == {
        "dimensionId": "epistemic.testing",
        "unitCount": 4,
        "observedUnitCount": 3,
        "missingUnitCount": 1,
        "missingRate": 0.25,
    }
    agreement = response["reviewerAgreement"][0]  # type: ignore[index]
    assert agreement["pairedUnitCount"] == 3
    assert agreement["exactAgreementRate"] == pytest.approx(2 / 3)
    assert agreement["meanAbsoluteDifference"] == pytest.approx(1 / 3)


@pytest.mark.contract
def test_aggregate_cli_accepts_the_schema_union_over_stdin(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    request = aggregate_request()
    stdin_path = tmp_path / "stdin.json"
    stdin_path.write_bytes(canonical_json_bytes(request))
    with stdin_path.open("rb") as raw_stdin:
        stdin = TextIOWrapper(raw_stdin, encoding="utf-8")
        monkeypatch.setattr(sys, "stdin", stdin)
        monkeypatch.setattr(sys, "argv", ["palimpsest.evaluation.process"])
        main()

    response = process_request(decode_request(request))
    assert capsys.readouterr().out.encode() == canonical_json_bytes(response) + b"\n"


def test_aggregation_clusters_origins_and_calculates_uncertainty_and_associations() -> None:
    response = process_request(decode_request(aggregate_request()))

    uncertainty = response["clusteredUncertainty"][0]  # type: ignore[index]
    assert uncertainty["dimensionId"] == "epistemic.testing"
    assert uncertainty["clusterCount"] == 2
    assert uncertainty["unitCount"] == 3
    assert uncertainty["estimate"] == pytest.approx(2.875)
    assert uncertainty["standardError"] == pytest.approx(1.125)
    assert uncertainty["confidence95"]["lower"] == pytest.approx(0.67)
    assert uncertainty["confidence95"]["upper"] == 4

    association = response["processOutcomeAssociations"][0]  # type: ignore[index]
    assert association["processMeasureId"] == "epistemic.supported-revision-rate.v1"
    assert association["outcomeMeasureId"] == "outcome.word-coverage.v1"
    assert association["unitPairCount"] == 3
    assert association["clusterCount"] == 2
    assert association["pearsonR"] == pytest.approx(1.0)
    assert association["claim"] == "observational"


@pytest.mark.parametrize(
    "mutation, message",
    [
        (lambda request: request["design"].update({"unknown": True}), "exactly"),
        (lambda request: request["scorecards"].append(request["scorecards"][0]), "unique"),
        (lambda request: request["scorecards"][0].update({"clusterId": "INVALID"}), "canonical"),
    ],
)
def test_aggregate_decoder_rejects_unknown_duplicate_and_invalid_cluster_inputs(
    mutation: object,
    message: str,
) -> None:
    request = aggregate_request()
    mutation(request)  # type: ignore[operator]
    with pytest.raises(ValueError, match=message):
        decode_request(request)
