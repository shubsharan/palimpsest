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
  "protocolVersion": "ledger-packets-v2",
  "detailsPath": "grading/process-review-<uuid>/manifest.json",
  "detailsDigest": "<sha256>",
  "reviews": [
    { "reviewId": "review-1", "providerFamily": "provider-a", "status": "completed" },
    { "reviewId": "review-2", "providerFamily": "provider-b", "status": "completed" }
  ]
}
```

The stored provider family and model identity are provenance added after each response returns. They are absent from packets and reviewer prompts. `status: completed` requires exactly two completed reviews with distinct provider families, identical bundle/rubric digests, and one consistent actual provider/model identity across every packet for each reviewer. `resumedFromAnalysisId` is omitted for an initial attempt and names exactly one immutable incomplete packet-protocol predecessor for an explicit resume.

## Detail Directory Contract

```text
grading/<analysis-id>/
├── manifest.json
├── evidence.json                 # performance analysis only
├── metrics.json                  # performance analysis only
├── packet-<artifact-key>.json    # process review call checkpoints
├── judge-1.raw.json              # ordered packet transcript
├── judge-2.raw.json
├── judge-1.review.json           # when every applicable packet validates
├── judge-2.review.json
└── scorecard.json                # completed process review only
```

- Every file is strict JSON with a trailing newline and canonical serialization for digesting.
- `manifest.json` lists schema version, file path, content digest, byte count, and semantic role for every detail file.
- Paths are relative, forward-slash separated, contained under the run root, and contain no empty, dot, parent, absolute, or backslash segment.
- Detail files are immutable after the analysis reference enters `run.json`.
- Unreferenced detail directories are non-evidentiary. A final append race leaves already-paid content-addressed call evidence intact for diagnosis rather than discarding it.

Each call file retains either a validated response or a failure together with the exact packet identity. A resumed analysis republishes validated predecessor call artifacts under the same content-addressed names without rewriting the predecessor. The artifact key covers bundle, configuration, rubric, reviewer profile and requested binding, packet ID/digest, routing/projection/prompt/schema versions, and the returned actual identity. Current request identities use `ledger-packets-v2`, `ledger-packet-prompt-v2`, and `ledger-packet-output-v2`; all three must match for reuse.

## Packet Output Contract

Each provider call returns one strict object for exactly one ledger packet:

```json
{
  "schemaVersion": 1,
  "rubricVersion": "epistemic-process-v1",
  "bundleDigest": "<sha256>",
  "packetId": "packet-epistemic-<digest-prefix>",
  "packetDigest": "<sha256>",
  "ledger": "epistemic",
  "dimensions": {
    "epistemic.revision": {
      "state": "rated",
      "rating": 3,
      "rationale": "The team changed the mapping after a conflicting stage and tested the replacement.",
      "evidenceIds": ["c017"],
      "counterevidenceIds": [],
      "confidence": "medium"
    }
  },
  "episodes": [],
  "cautions": []
}
```

Validation rules:

- The root and every nested object set `additionalProperties: false`; all declared fields are required.
- Packet identity and ledger exactly match the request.
- The dimension object contains exactly the packet ledger's rubric dimension keys.
- Every dimension has the same required fields. `rating` is an integer 0-4 only with `state: rated`; otherwise it is `null`.
- Every rated dimension has at least one valid supporting reference.
- `unobservable` and `not-applicable` use `rating: null` and explain why.
- The epistemic output contains the required evidence-linked episode structure. Social and instrumental packet schemas omit that field.
- Citation fields are arrays of compact strings matching `^c[0-9]{3}$`; the provider schema does not enumerate packet membership.
- After parse, citation tokens must be unique, resolve within the exact packet, and reproduce their source reference and excerpt digest.
- No field contains a total score, model guess, unsupported hidden-state claim, or outcome claim.

For isolated origins the system makes no social call and inserts the ordered social dimensions as `not-applicable`. Deterministic review assembly orders all dimensions by the global rubric, takes episodes only from epistemic output, and concatenates cautions in epistemic/social/instrumental order.

Episode assembly is conservative and deterministic:

1. Retain an uptake reference only when an earlier transmission from a different actor exists.
2. Retain an integration reference only when it is at or after the latest retained uptake; if no uptake remains, clear integration.
3. Never invent, union, or move citations between stages.
4. Keep the raw packet response unchanged and append an assembly caution listing each affected stage and its suppressed-reference count.

## Packet Failure Contract

Every unsuccessful call is retained with:

- a stable classification and sanitized message;
- normalized and raw finish reasons when a response exists;
- provider-reported usage or an explicit unavailable marker;
- response ID and actual provider/model identity when supplied;
- `textReturned` and any returned outcome-blind text;
- structured parse status distinguishing malformed JSON, schema-invalid output, refusal, filtering, length exhaustion, and unavailable parsing.

Transport/SDK failures remain typed and sanitized. Missing metadata is recorded as unavailable rather than replaced with success-shaped values or a generic empty-output failure.

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
- Legacy window/candidate/integration reviews and `ledger-packets-v1` analyses remain readable but cannot supply packet checkpoints to protocol-v2 `--resume`.
- Historical `git.changed` events without ref targets remain valid. Measures that need an event-time object ID return `unavailable`.
- A trace without `run.json` remains an interrupted attempt and cannot receive completed-run analyses.
- Unknown future rubric, grader, or detail schema versions fail explicitly.
