# Data Model: Blind Calibration and Team-Level Evaluation

## Checker Feedback

Strict agent-visible result under `published-runnability-coverage-v1`.

| Field | Type | Rule |
| --- | --- | --- |
| `feedbackId` | literal identifier | `published-runnability-coverage-v1` |
| `ref` | literal ref | `refs/heads/main` when captured |
| `commit` | SHA-1 string | Present when the ref resolves |
| `executionStatus` | enum | `succeeded`, `failed`, `timed-out`, `oversized`, or `indeterminate` |
| `outputValidity` | enum | `valid`, `missing`, `empty`, `malformed`, `oversized`, or `incomplete` |
| `ciphertextWords` | non-negative integer | Counted from released ciphertext only |
| `outputWords` | non-negative integer | Counted from readable candidate only |
| `coverage` | number in `[0, 1]` | Bounded output-word coverage of ciphertext words |
| `error` | optional string | Submission category only; never oracle-derived |

The result has no match count, accuracy, delta, mismatch position, expected word, key, or oracle field.

## Validity Tiers

### Evidence Tier

Ordered `strict > balanced > fallback`. Records the selected threshold name and metrics for specialist ownership share, owner occurrences, solo coverage, region balance, stage balance, sentinels, anchors, and changed mass. Provider-backed work accepts `strict` or `balanced` only.

### Control Tier

Ordered `strict > balanced > fallback`. Records changed-type count, matched-control count, completeness, maximum and mean selected distance, and the threshold bounds used. Calibration requires completeness and an explicit tier. Validation requires `strict` or `balanced`.

## Puzzle Build v4

Retains paired build identity, source, references, seed, selected window, geometry, variants, oracle-design digests, manipulation check, and:

- `evidenceTier`
- `controlTier`
- allocation record path/digest and rejected evidence tiers
- phase-gate eligibility derived from the catalog phase

The paired build identity includes both tier records so a validity change changes identity.

## Canonical Origin

| Field                 | Type                 | Rule                                         |
| --------------------- | -------------------- | -------------------------------------------- |
| `originId`            | `shared` or agent ID | Derived from frozen condition                |
| `repositoryId`        | Git repository ID    | Must match the frozen topology               |
| `ref`                 | literal ref          | Always `refs/heads/main`                     |
| `commit`              | optional SHA-1       | Captured literal commit when available       |
| `realizedTeamProduct` | boolean              | True only for the shared origin in `CS`/`CR` |

Shared attempts contain exactly one canonical origin. Isolated attempts contain exactly `agent-1`, `agent-2`, and `agent-3`.

## Origin Evaluation

| Field | Type | Rule |
| --- | --- | --- |
| `origin` | Canonical Origin | Never reviewer-selected |
| `status` | enum | `scored`, `not-runnable`, `no-output`, or `execution-error` |
| `execution` | optional sandbox result | Present after solver invocation |
| `aggregate` | optional aggregate score | Present only for `scored` |
| `diagnostics` | optional diagnostic score | Present only for `scored` |
| `error` | optional string | Terminal submission detail |
| `outputProvenance` | optional sealed output identity | Contains no candidate text |

Every expected canonical origin has exactly one terminal result.

## Diagnostic Score

Every accuracy cell is `{ matchedWords, totalWords, accuracy }`, where `accuracy` is `null` when `totalWords` is zero.

- `overall`
- `regions.preBoundary`, `regions.postBoundary`
- `changed.preBoundary`, `changed.postBoundary`
- `controls.preBoundary`, `controls.postBoundary`
- `sentinels.preBoundary`, `sentinels.postBoundary`
- `specialists.preBoundary`, `specialists.postBoundary`
- `stages[]` keyed by stage ordinal
- `evidenceOwners[]` keyed by agent ID
- `changedTypes[]` keyed by normalized changed type
- `macroChangedTypeAccuracy`
- `positionHandling` with expected, predicted, compared, missing, extra, and coverage

Missing expected tokens are incorrect. Extra tokens affect the aggregate denominator and extra count but no source-derived partition.

## Team Evaluation

| Field | Type | Rule |
| --- | --- | --- |
| `realizedProductOriginId` | origin ID or `null` | Shared origin only |
| `collectiveCeiling` | score or `null` | Requires at least one scoreable origin |
| `integrationGap` | number or `null` | Requires realized product and at least two scoreable origins |
| `integrationGapReason` | identifier or `null` | Required exactly when gap is `null` |

The collective ceiling contains aggregates only. It never contains or points to a synthetic reconstruction.

## Evaluation Record v2

- schema and policy identities
- attempt, condition, build, and protocol identities
- ordered canonical origin results
- team evaluation
- evaluation start and completion times
- explicit infrastructure status

No workspace, notes, alternate command, alternate output path, or reviewer rationale exists.

## Attempt Summary v6

Extends the existing frozen attempt with checking and scoring policy identities, exact canonical origin set, evaluation and behavior-review references, and resolved null token cutoff for the calibration. Model outcomes remain separate from attempt validity and infrastructure classification.

## Design Receipt v3

Binds manifest v5 digest, resolved run controls, five puzzle-build v4 identities and tree seals, checker/scoring/evaluation policies, behavior rubric, model assignment, schedule, null token ceilings, monetary authorization, source revision, and sandbox identity.

## Behavior Review

Each section has a status, trace evidence references, and a concise observation for communication, integration, interference, recovery, rule replacement, recognition, checker use, usage, reasoning-summary coverage, and final provenance. Absence of evidence is explicit. Empty captured reasoning summaries are not missing hidden reasoning.

## State Transitions

```text
catalog source pinned
  -> bounded discovery
  -> phase gate passed
  -> puzzle build v4 sealed
  -> design receipt v3 published
  -> attempt reserved
  -> model sessions active (blind checker only)
  -> repositories and workspaces frozen
  -> attempt summary v6 published
  -> all canonical origins evaluated
  -> diagnostics and team result published
  -> behavior review published
  -> phase cell indexed
```

Any invalid catalog gate stops before credential or adapter creation. Any post-freeze origin submission failure becomes a terminal origin result. Trusted evaluation infrastructure failure preserves the attempt and fails the phase without rerunning model work.
