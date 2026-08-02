# Data Contract: Epistemic Process Grader

## Run Record Extension

`RunRecord.schemaVersion` remains `1`. Existing records and `overlap` analyses remain valid. `analyses` becomes a strict discriminated union of `overlap`, `performance`, and `process-review`.

### Performance Analysis Reference

```json
{
  "analysisId": "performance-<uuid>",
  "kind": "performance",
  "analyzedAt": "2026-08-02T00:00:00.000Z",
  "graderVersion": "epistemic-process-v1",
  "configurationDigest": "<sha256>",
  "sourceDigest": "<sha256>",
  "detailsPath": "grading/performance-<uuid>/manifest.json",
  "detailsDigest": "<sha256>",
  "origins": [{ "originId": "shared", "status": "eligible" }]
}
```

Origin status is `eligible`, `unavailable`, or `not-applicable` with a required reason unless eligible. Origin order matches the run topology.

### Process Review Analysis Reference

```json
{
  "analysisId": "process-review-<uuid>",
  "kind": "process-review",
  "reviewedAt": "2026-08-02T00:10:00.000Z",
  "status": "completed",
  "performanceAnalysisId": "performance-<uuid>",
  "rubricVersion": "epistemic-process-v1",
  "configurationDigest": "<sha256>",
  "bundleDigest": "<sha256>",
  "detailsPath": "grading/process-review-<uuid>/manifest.json",
  "detailsDigest": "<sha256>",
  "reviews": [
    { "reviewId": "review-1", "providerFamily": "provider-a", "status": "completed" },
    { "reviewId": "review-2", "providerFamily": "provider-b", "status": "completed" }
  ]
}
```

The stored provider family and model identity are provenance added after each response returns. They are absent from the evidence bundle and judge prompt. `status: completed` requires exactly two completed reviews with distinct provider families and identical bundle/rubric digests.

## Detail Directory Contract

```text
grading/<analysis-id>/
├── manifest.json
├── evidence.json                 # performance analysis only
├── metrics.json                  # performance analysis only
├── judge-1.raw.json              # process review only
├── judge-1.review.json           # when structurally valid
├── judge-2.raw.json
├── judge-2.review.json
└── scorecard.json                # completed process review only
```

- Every file is strict JSON with a trailing newline and canonical serialization for digesting.
- `manifest.json` lists schema version, file path, content digest, byte count, and semantic role for every detail file.
- Paths are relative, forward-slash separated, contained under the run root, and contain no empty, dot, parent, absolute, or backslash segment.
- Detail files are immutable after the analysis reference enters `run.json`.
- Unreferenced detail directories are non-evidentiary and are reported by validation; the normal publication path removes only the newly created directory if record append fails.

## Review Output Contract

Each judge must return one strict object:

```json
{
  "schemaVersion": 1,
  "rubricVersion": "epistemic-process-v1",
  "bundleDigest": "<sha256>",
  "dimensions": [
    {
      "dimensionId": "epistemic.revision",
      "ledger": "epistemic",
      "state": "rated",
      "rating": 3,
      "rationale": "The team changed the mapping after a conflicting stage and tested the replacement.",
      "evidence": [
        {
          "source": "trace",
          "traceSequence": 314,
          "excerptDigest": "<sha256>",
          "role": "support"
        }
      ],
      "counterevidence": [],
      "confidence": "medium"
    }
  ],
  "episodes": [],
  "overallCautions": []
}
```

Validation rules:

- The dimension list exactly matches the rubric's ordered dimensions.
- Ratings are integers 0-4 and appear only with `state: rated`.
- Every rated dimension has at least one valid supporting reference.
- `unobservable` and `not-applicable` have no rating and explain why.
- Social dimensions are `not-applicable`, not zero, when peer communication is unavailable.
- All references resolve within the exact evidence bundle and reproduce their excerpt digest.
- No field contains a total score, model guess, unsupported hidden-state claim, or outcome claim.

## Rubric V1

### Epistemic Dimensions

1. `epistemic.framing`: forms useful representations and distinguishes known, assumed, and unknown.
2. `epistemic.hypotheses`: proposes plausible, discriminable hypotheses rather than accumulating guesses.
3. `epistemic.testing`: seeks evidence capable of changing the current commitment.
4. `epistemic.calibration`: expresses and behaves with uncertainty proportionate to evidence.
5. `epistemic.revision`: responds to contrary evidence and carries revisions into later action.
6. `epistemic.integration`: preserves compatible learning across stages and detects regime changes.

### Social Dimensions

1. `social.contribution`: supplies novel, useful evidence, hypotheses, tests, or artifacts.
2. `social.transmission`: communicates claims with enough context and uncertainty for peers to use.
3. `social.uptake`: attends to and tests or applies peer contributions.
4. `social.integration`: incorporates distributed work into the canonical team trajectory.
5. `social.verification`: independently checks important shared claims instead of merely echoing them.
6. `social.repair`: resolves duplication, conflict, stale assumptions, or integration failure productively.

### Instrumental Dimensions

1. `instrumental.execution`: converts ideas into concrete tests and artifacts.
2. `instrumental.tooling`: uses available tools purposefully and interprets their results.
3. `instrumental.validation`: checks solver behavior and distinguishes evidence from assertion.
4. `instrumental.publication`: keeps the canonical deliverable runnable and current.
5. `instrumental.resources`: allocates time, tokens, and repeated work in service of information gain.
6. `instrumental.recovery`: detects and recovers from errors without concealing failure.

Each dimension has separate behaviorally anchored 0-4 descriptions in the versioned runtime rubric. The shared directional labels do not substitute for those anchors.

## Evidence Leakage Contract

Before any provider call, recursively reject reviewer bundles containing:

- model profiles, requested models, actual models, provider names, or response identities;
- manifest or run labels that reveal those identities;
- fixture oracle data, plaintext, keys, or manipulation-check results;
- `evaluation.completed` events, evaluation batches, matched-word counts, coverage, accuracy, or success labels;
- prior grading analyses or human/model review results.

Allowed process context includes anonymous actor IDs, communication availability, stage timing, agent-visible evidence references, model-visible response text, tool calls/results, team messages, Git observations/content, session termination, and resource usage. The bundle manifest records every excluded source field so the blind is auditable.

## Compatibility

- A legacy record without grading analyses decodes unchanged.
- Historical `git.changed` events without ref targets remain valid. Measures that need an event-time object ID return `unavailable`.
- A trace without `run.json` remains an interrupted attempt and cannot receive completed-run analyses.
- Unknown future rubric, grader, or detail schema versions fail explicitly.
