# Data Model: Puzzle Architecture Refactor

The refactor changes ownership and validation, not stored schemas. Existing schema versions, field names, path semantics, and JSON formatting remain compatible.

## Puzzle Build

Represents one deterministic construction and its three six-stage private streams.

| Field                  | Type                 | Rules                                           |
| ---------------------- | -------------------- | ----------------------------------------------- |
| `schemaVersion`        | integer              | Exactly `1`                                     |
| `buildId`              | string               | `build-` plus lowercase SHA-256                 |
| `agentCount`           | integer              | Exactly `3`                                     |
| `stageCount`           | integer              | Exactly `6`                                     |
| `transitionStage`      | integer              | Between `2` and `6`, inclusive                  |
| `stageIntervalMs`      | integer              | Positive                                        |
| `changedSymbols`       | string array         | Nonempty, unique, sorted                        |
| `publicCiphertextPath` | relative path        | Safe path inside build root                     |
| `referenceCorpusPath`  | relative path        | Safe path inside build root                     |
| `privateStageRoots`    | agent-to-path map    | Exactly the three declared agents               |
| `oracleRoot`           | relative path        | Safe path inside build root                     |
| `stages`               | Evidence Stage array | Exactly 18 stages; six ordered stages per agent |

### Evidence Stage

| Field             | Type          | Rules                                                      |
| ----------------- | ------------- | ---------------------------------------------------------- |
| `agentId`         | enum          | `agent-1`, `agent-2`, or `agent-3`                         |
| `ordinal`         | integer       | `1` through `6`, unique within an agent                    |
| `releaseOffsetMs` | integer       | `(ordinal - 1) * stageIntervalMs`                          |
| `sourcePath`      | relative path | Safe path inside build root                                |
| `tokenCount`      | integer       | Positive                                                   |
| `sha256`          | string        | Lowercase SHA-256                                          |
| `regime`          | enum          | `base` before `transitionStage`; `revised` at and after it |

### Relationships

- One Puzzle Build owns exactly 18 Evidence Stages.
- Each agent owns one contiguous six-stage stream.
- All streams share one transition ordinal and changed-symbol set.
- The public ciphertext and oracle paths belong to the build but stay outside agent workspaces.

## Attempt Summary

Represents one completed and frozen model attempt. It is the durable input to later evaluation and does not depend on successful overlap observation.

| Field | Type | Rules |
| --- | --- | --- |
| `attemptId` | string | Nonempty and unchanged from the run result |
| `buildRoot` | absolute path | Existing build containing the decoded Puzzle Build |
| `tracePath` | absolute path | Existing `trace.jsonl` |
| `traceMetadataPath` | absolute path | Existing `trace.meta.json` |
| `frozenRoot` | absolute path | Existing frozen Git/workspace root |
| `sandbox` | Sandbox Identity plus Policy | Complete immutable image identity and current limits |
| `sessions` | Session Result array | Exactly one result per declared agent |

### Session Result

| Field               | Type            | Rules                                                 |
| ------------------- | --------------- | ----------------------------------------------------- |
| `agentId`           | agent enum      | Unique across the array                               |
| `state`             | enum            | Existing finished, exhausted, or infrastructure state |
| `inputTokens`       | integer         | Nonnegative                                           |
| `outputTokens`      | integer         | Nonnegative                                           |
| `finalResponse`     | optional string | Present only when supplied by the session             |
| `terminationReason` | optional string | Existing reason semantics preserved                   |

### Persistence Rules

- The writer creates `attempt.json` once, from a complete encoded value, immediately after freeze.
- Persistence is atomic and exclusive; an existing summary is never overwritten.
- Failure to persist stops before overlap observation.
- Successful persistence is never rolled back because overlap later fails.
- Evaluation requires this summary but does not require `overlap.json`.

## Observation Trace

### Trace Metadata

| Field           | Type          | Rules                          |
| --------------- | ------------- | ------------------------------ |
| `schemaVersion` | integer       | Exactly `1`                    |
| `startedAt`     | ISO timestamp | Valid finite wall-clock origin |

### Trace Event

| Field      | Type                | Rules                                                     |
| ---------- | ------------------- | --------------------------------------------------------- |
| `sequence` | integer             | Starts at `1`, increments by exactly one                  |
| `atMs`     | number              | Finite, nonnegative, and nondecreasing                    |
| `kind`     | string              | Nonempty existing event kind or targeted `overlap.failed` |
| `agentId`  | optional agent enum | Only for agent-specific events                            |
| `data`     | JSON value          | Recursively redacted through the shared trace path        |

The metadata file is created before the JSONL file and never rewritten. Reopening validates every existing line before append.

## Overlap Observation

Represents optional analysis of unique reachable Git text.

| Field      | Type                  | Rules                            |
| ---------- | --------------------- | -------------------------------- |
| `findings` | Overlap Finding array | Stable deterministic sort        |
| `scan`     | Scan Metadata         | Exactly six nonnegative counters |

### Overlap Finding

| Field           | Type    | Rules                                      |
| --------------- | ------- | ------------------------------------------ |
| `committedPath` | string  | Nonempty logical Git path                  |
| `sourceKind`    | enum    | `private-ciphertext` or `plaintext`        |
| `sourceId`      | string  | Nonempty source identity                   |
| `matchKind`     | enum    | `exact` or `normalized`                    |
| `wordCount`     | integer | Positive and at least configured threshold |
| `sha256`        | string  | Lowercase SHA-256 of matched evidence      |

### Scan Metadata

- `reachableObjectCount`
- `reachableBlobReferenceCount`
- `uniqueReachableBlobCount`
- `uniqueTextBlobCount`
- `repeatedTreeReferenceCount`
- `skippedNonTextBlobCount`

Every counter is a nonnegative integer. Overlap never changes attempt status or reconstruction score.

## Evaluation Result

Represents one reviewer selection and one-shot execution against a frozen attempt.

| Field | Type | Rules |
| --- | --- | --- |
| `status` | enum | `scored`, `not-runnable`, `no-output`, or `execution-error` |
| `selection` | optional Evaluation Selection | Recorded before execution when runnable |
| `execution` | optional Sandbox Command Result | Present when a command ran |
| `outputPath` | optional path | Validated regular file inside evaluation workspace |
| `score` | optional Aggregate Score | Present for `scored` |
| `error` | optional string | Present under existing error-status rules |

### Evaluation Selection

| Field        | Type            | Rules                               |
| ------------ | --------------- | ----------------------------------- |
| `command`    | string          | Nonempty shell source               |
| `outputPath` | relative path   | Safe path inside selected workspace |
| `notes`      | optional string | Reviewer context                    |

### Aggregate Score

| Field          | Type    | Rules                        |
| -------------- | ------- | ---------------------------- |
| `matchedWords` | integer | Between `0` and `totalWords` |
| `totalWords`   | integer | Nonnegative                  |
| `coverage`     | number  | Between `0` and `1`          |
| `accuracy`     | number  | Between `0` and `1`          |

## Sandbox Identity and Policy

### Sandbox Identity

| Field            | Type    | Rules                            |
| ---------------- | ------- | -------------------------------- |
| `imageTag`       | string  | Existing supported tag           |
| `imageId`        | string  | Inspected immutable image ID     |
| `sourceDigest`   | string  | Checked-in sandbox source digest |
| `profileVersion` | integer | Exactly `1`                      |

### Sandbox Policy

| Field            | Value        |
| ---------------- | ------------ |
| `network`        | `none`       |
| `cpus`           | `2`          |
| `memoryBytes`    | `2147483648` |
| `pids`           | `256`        |
| `tmpfsBytes`     | `268435456`  |
| `maxOutputBytes` | `4194304`    |

Policy fields are operational context, never puzzle-validity criteria.

## Fixture Scenario

| Value | Meaning |
| --- | --- |
| `collaborative-revision` | The existing deterministic three-agent script demonstrating an initial rule, contradictory stage-four evidence, peer-visible work, and later revision |

Omission selects `collaborative-revision`. Every other supplied value fails before sandbox construction or attempt output creation.

## State Transitions

| From | Event | To | Durable Records |
| --- | --- | --- | --- |
| Configured | Sessions start | Running | Trace metadata and configured event |
| Running | All sessions end or cutoff occurs | Sessions Ended | Session results and trace |
| Sessions Ended | Git/workspaces freeze | Frozen | Frozen repository/workspaces and trace |
| Frozen | Attempt writer succeeds | Summarized | `attempt.json` |
| Summarized | Overlap succeeds | Observed | `overlap.json` and `overlap.observed` |
| Summarized | Overlap fails | Observation Failed | Existing summary/frozen inputs; optional `overlap.failed`; no fabricated overlap artifact |
| Summarized, Observed, or Observation Failed | Reviewer evaluates | Evaluated | `selection.json` and `result.json` |

An attempt cannot enter overlap observation before `Summarized`. Evaluation may begin from any state at or after `Summarized`.
