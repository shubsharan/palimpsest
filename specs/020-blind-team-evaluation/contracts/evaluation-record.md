# Contract: All-Canonical-Origin Evaluation

Policy identifier: `all-canonical-main-snapshots-v1`

Primary metric: `normalized-positional-word-v1`

Diagnostic metric: `palimpsest-diagnostics-v1`

## Operator Interface

```text
puzzle:evaluate --attempt <frozen-attempt>
```

The command rejects workspace, notes, command, output-path, branch, ref, rank, repair, or merge inputs.

## Canonical Targets

- `CS` and `CR`: exactly one `shared` origin.
- `IS` and `IR`: exactly `agent-1`, `agent-2`, and `agent-3`.

Only each origin's literal frozen `refs/heads/main` is captured. Every target receives one terminal result.

## Evaluation Record v2

```json
{
  "schemaVersion": 2,
  "evaluationPolicyId": "all-canonical-main-snapshots-v1",
  "primaryMetricId": "normalized-positional-word-v1",
  "diagnosticMetricId": "palimpsest-diagnostics-v1",
  "attemptId": "attempt-id",
  "condition": "IR",
  "origins": [],
  "team": {
    "realizedProductOriginId": null,
    "collectiveCeiling": {},
    "integrationGap": null,
    "integrationGapReason": "isolated-no-realized-product"
  }
}
```

Origin entries contain origin identity, captured commit when available, terminal status, execution, aggregate score and diagnostics when scoreable, error, and output provenance. They contain no reconstruction text.

The team record never points to a synthetic solver or reconstruction.
