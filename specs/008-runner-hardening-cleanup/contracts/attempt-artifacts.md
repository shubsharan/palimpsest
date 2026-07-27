# Attempt Artifact Contract

## `trace.meta.json`

```json
{
  "schemaVersion": 1,
  "startedAt": "2026-07-27T18:00:00.000Z"
}
```

The file is created exclusively before `trace.jsonl` and is never rewritten.

## `trace.jsonl`

Each line is one observation:

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
2. `atMs` is finite, non-negative, and never lower than the previous event.
3. Optional `agentId` is one of `agent-1`, `agent-2`, or `agent-3`.
4. Every producer applies the same recursive secret-field redaction.
5. Reopening validates the complete existing file before appending.

## `attempt.json`

The existing attempt, build, trace, frozen, and session fields remain. Add:

```json
{
  "traceMetadataPath": "/absolute/attempt/trace.meta.json",
  "sandbox": {
    "imageTag": "palimpsest-puzzle-sandbox:0.1.0",
    "imageId": "sha256:...",
    "sourceDigest": "...",
    "network": "none",
    "cpus": 2,
    "memoryBytes": 2147483648,
    "pids": 256,
    "tmpfsBytes": 268435456,
    "maxOutputBytes": 4194304
  }
}
```

The sandbox block is operational context only.

## `overlap.json`

Retain the overlap observations and add:

```json
{
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

The scan describes current-ref reachability. It does not change the score or attempt status.
