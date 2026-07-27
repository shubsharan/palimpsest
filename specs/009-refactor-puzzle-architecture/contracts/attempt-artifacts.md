# Active Attempt Artifact Contract

These are the active records produced and consumed by the refactored runner. The current build-run-evaluate flow validates them strictly. Records from earlier implementations receive no migration or compatibility reader; existing shapes remain only where they are already the shortest adequate current representation.

## `puzzle-build.json`

The build manifest remains schema version 1:

```json
{
  "schemaVersion": 1,
  "buildId": "build-...",
  "agentCount": 3,
  "stageCount": 6,
  "transitionStage": 4,
  "stageIntervalMs": 120000,
  "changedSymbols": ["..."],
  "publicCiphertextPath": "evaluation/ciphertext.txt",
  "referenceCorpusPath": "public/reference",
  "privateStageRoots": {
    "agent-1": "private/agent-1/stages",
    "agent-2": "private/agent-2/stages",
    "agent-3": "private/agent-3/stages"
  },
  "oracleRoot": "oracle",
  "stages": []
}
```

Each stage retains `agentId`, `ordinal`, `releaseOffsetMs`, `sourcePath`, `tokenCount`, `sha256`, and `regime`.

## `trace.meta.json`

```json
{
  "schemaVersion": 1,
  "startedAt": "2026-07-27T18:00:00.000Z"
}
```

The metadata file is created exclusively before `trace.jsonl` and is never rewritten.

## `trace.jsonl`

Each line remains one redacted observation:

```json
{
  "sequence": 1,
  "atMs": 0.42,
  "kind": "attempt.configured",
  "data": {}
}
```

Rules:

1. Sequence begins at one and increments by exactly one.
2. `atMs` is finite, nonnegative, and never lower than the preceding event.
3. Optional `agentId` is `agent-1`, `agent-2`, or `agent-3`.
4. Every producer applies the same recursive secret-field redaction.
5. Reopening validates the complete existing file before appending.
6. Successful overlap appends `overlap.observed`.
7. Failed post-freeze overlap appends `overlap.failed` when the trace remains writable; failure to append this diagnostic must not replace the primary overlap failure.

## `attempt.json`

The exact summary remains:

```json
{
  "attemptId": "attempt-...",
  "buildRoot": "/absolute/build",
  "tracePath": "/absolute/attempt/trace.jsonl",
  "traceMetadataPath": "/absolute/attempt/trace.meta.json",
  "frozenRoot": "/absolute/attempt/frozen",
  "sandbox": {
    "imageTag": "palimpsest-puzzle-sandbox:0.1.0",
    "imageId": "sha256:...",
    "sourceDigest": "...",
    "profileVersion": 1,
    "network": "none",
    "cpus": 2,
    "memoryBytes": 2147483648,
    "pids": 256,
    "tmpfsBytes": 268435456,
    "maxOutputBytes": 4194304
  },
  "sessions": []
}
```

The sandbox block remains operational context only.

### Durability Rule

1. Sessions end, trace data flushes, and Git/workspaces freeze.
2. The complete summary is encoded.
3. A temporary file in the exclusively owned attempt directory is written completely and atomically renamed to `attempt.json`.
4. Only after the summary exists may overlap input collection begin.
5. Overlap failure never removes, rewrites, or invalidates the summary, trace, frozen Git, or frozen workspaces.

`attempt.json` intentionally contains no overlap status or path. Evaluation remains valid whenever the summary exists, regardless of whether overlap succeeded.

The run command creates the attempt root exclusively before work begins. Concurrent writers to the same attempt root are unsupported, so summary publication does not add hard-link, lock, or multi-writer coordination machinery.

## `overlap.json`

On success the artifact remains:

```json
{
  "findings": [],
  "scan": {
    "reachableObjectCount": 0,
    "reachableBlobReferenceCount": 0,
    "uniqueReachableBlobCount": 0,
    "uniqueTextBlobCount": 0,
    "repeatedTreeReferenceCount": 0,
    "skippedNonTextBlobCount": 0
  }
}
```

The scan describes current-ref reachability and never changes score or attempt validity.

If observation fails:

- no fabricated success-shaped `overlap.json` is written;
- a partial overlap-input directory may remain as diagnostic material;
- the run command exits nonzero, reports the original error through standard error, and emits no success JSON;
- `overlap.failed` is appended when the trace remains writable, but diagnostic failure never replaces the original observation error;
- `attempt.json` and frozen inputs remain evaluatable.

No overlap-failure sidecar is created. Command output is the authoritative failure report.

## Evaluation Artifacts

Evaluation remains one-shot because the `evaluation/` directory is created exclusively.

When a runnable selection exists, `selection.json` is persisted before command execution:

```json
{
  "command": "sh solve.sh",
  "outputPath": "reconstruction.txt",
  "notes": "Reviewer context"
}
```

`result.json` retains the existing status union:

```json
{
  "status": "scored",
  "selection": {},
  "execution": {},
  "outputPath": "/absolute/evaluation/workspace/reconstruction.txt",
  "score": {
    "matchedWords": 0,
    "totalWords": 0,
    "coverage": 0,
    "accuracy": 0
  }
}
```

The optional `selection`, `execution`, `outputPath`, `score`, and `error` fields remain governed by `scored`, `not-runnable`, `no-output`, and `execution-error` semantics.

## Decoder Failure Rules

- Invalid JSON, non-object roots, unsupported versions, missing fields, wrong types, invalid enum values, unsafe paths, impossible stage geometry, malformed sandbox identity, or negative counters fail explicitly.
- Decoders do not fill missing fields, coerce values, or return partial success objects.
- Records produced by the active refactored flow decode without partial defaults.
- Records produced by earlier implementations are unsupported and receive no migration or compatibility wrapper.
