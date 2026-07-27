# Data Model: Behavior-Neutral Multi-Agent Puzzle Runner

## PuzzleBuild

Host-only description of a prepared puzzle.

| Field                  | Type     | Rules                                                   |
| ---------------------- | -------- | ------------------------------------------------------- |
| `buildId`              | string   | Stable identifier derived from configuration and seeds  |
| `agentCount`           | integer  | Exactly `3`                                             |
| `stageCount`           | integer  | Exactly `6`                                             |
| `transitionStage`      | integer  | Shared across streams; default `4`                      |
| `stageIntervalMs`      | integer  | Positive; default `120000`                              |
| `changedSymbols`       | string[] | Non-empty proper subset of cipher alphabet              |
| `publicCiphertextPath` | path     | Complete ciphertext for final execution                 |
| `referenceCorpusPath`  | path     | Target-excluded corpus visible to every agent           |
| `privateStageRoots`    | 3 paths  | Host-private immutable stage sources                    |
| `oracleRoot`           | path     | Plaintext, keys, and checker truth; never agent-visible |

### Invariants

- Every agent has six non-empty ordered stage files.
- Stages 1-3 use the base mapping and stages 4-6 use the revised mapping.
- The revised mapping is a complete substitution, differs on `changedSymbols`, and matches the base mapping elsewhere.
- Each private stream has useful token mass on both sides of the transition.
- Releasing a later stage never changes bytes in an earlier stage file.

## AttemptConfig

Operator-selected runtime configuration.

| Field                 | Type    | Rules                                  |
| --------------------- | ------- | -------------------------------------- |
| `attemptId`           | string  | Unique within artifact root            |
| `buildPath`           | path    | Existing valid `PuzzleBuild`           |
| `artifactRoot`        | path    | New attempt-local directory            |
| `adapter`             | enum    | `fixture` or `openai`                  |
| `model`               | string  | Required for live adapter              |
| `tokenBudgetPerAgent` | integer | Positive cumulative model-token budget |
| `wallTimeMs`          | integer | Positive global monotonic duration     |
| `shutdownToleranceMs` | integer | Positive; default `5000`               |
| `fixtureScenario`     | string? | Offline adapter behavior               |

## AgentSession

One independent persistent model context.

| Field | Type | Rules |
| --- | --- | --- |
| `agentId` | enum | `agent-1`, `agent-2`, or `agent-3` |
| `providerSessionId` | string? | Adapter-owned persistent context identifier |
| `workspacePath` | path | Agent-private Git clone and work files |
| `evidencePath` | path | Agent-private released evidence directory |
| `state` | enum | `working`, `waiting`, `finished`, `token-exhausted`, `time-exhausted`, `infrastructure-error` |
| `inputTokens` | integer | Monotonic non-negative cumulative count |
| `outputTokens` | integer | Monotonic non-negative cumulative count |
| `activityCursor` | integer | Last consumed event sequence |
| `finalResponse` | string? | Present only after voluntary finish |
| `terminationReason` | string? | Required for terminal states |

### State Transitions

```text
working -> waiting -> working
working -> finished
working|waiting -> token-exhausted
working|waiting -> time-exhausted
working|waiting -> infrastructure-error
```

Terminal sessions are never reinvoked. One session's terminal state does not terminate peers except when the global wall-time deadline produces `time-exhausted`.

## EvidenceStage

One immutable private release.

| Field             | Type     | Rules                                         |
| ----------------- | -------- | --------------------------------------------- |
| `agentId`         | agent ID | Exactly one recipient                         |
| `ordinal`         | integer  | `1..6`                                        |
| `releaseOffsetMs` | integer  | `(ordinal - 1) * stageIntervalMs`             |
| `sourcePath`      | path     | Host-private prepared bytes                   |
| `releasedPath`    | path?    | Agent-private destination after release       |
| `releasedAtMs`    | integer? | Monotonic offset; never earlier than schedule |
| `regime`          | enum     | `base` for 1-3, `revised` for 4-6             |

## ActivityEvent

Append-only wake signal.

| Field          | Type      | Rules                                       |
| -------------- | --------- | ------------------------------------------- |
| `sequence`     | integer   | Strictly increasing within attempt          |
| `kind`         | enum      | `stage-released` or `git-changed`           |
| `occurredAtMs` | integer   | Monotonic attempt offset                    |
| `agentId`      | agent ID? | Recipient for private stage; absent for Git |
| `detail`       | object    | Paths and refs only; no oracle data         |

A waiting agent resumes only for an event after its cursor that is visible to it.

## CheckerObservation

Aggregate result retained for one voluntary checker call.

| Field | Type | Rules |
| --- | --- | --- |
| `agentId` | agent ID | Caller |
| `candidatePath` | path | Must resolve within caller workspace |
| `releasedStages` | integer[] | Snapshot of visible ordinals |
| `matchedWords` | integer | Non-negative |
| `totalWords` | integer | Maximum expected/candidate token count |
| `coverage` | number | Candidate positions available over expected positions, clamped to `[0,1]` |
| `accuracy` | number | Matched words over `totalWords`, clamped to `[0,1]` |
| `error` | string? | Replaces metrics on execution/read failure |

The agent-visible result contains no expected words, correct words, mismatch positions, or per-stage breakdown.

## ObservationEvent

Append-only JSONL record.

| Field | Type | Rules |
| --- | --- | --- |
| `sequence` | integer | Strictly increasing |
| `atMs` | integer | Monotonic attempt offset |
| `kind` | string | Configuration, model, tool, lifecycle, stage, Git, checker, freeze, reviewer, execution, score, overlap, or infrastructure event |
| `agentId` | agent ID? | Present for session-scoped events |
| `data` | object | Raw event payload with secrets redacted |

The trace is evidence for interpretation, not a replay or artifact-promotion protocol.

## FrozenAttempt

Read-only post-run snapshot.

| Field              | Type      | Rules                                      |
| ------------------ | --------- | ------------------------------------------ |
| `attemptId`        | string    | Matches runtime attempt                    |
| `frozenAt`         | timestamp | Recorded after all processes stop          |
| `repositoryPath`   | path      | Frozen bare repository and review checkout |
| `workspacePaths`   | 3 paths   | Frozen agent workspaces                    |
| `tracePath`        | path      | Completed observation JSONL                |
| `sessionSummaries` | 3 objects | Terminal state and token usage             |
| `overlapPath`      | path      | Narrow observation findings                |

## EvaluationSelection

Reviewer-authored execution choice.

| Field        | Type      | Rules                           |
| ------------ | --------- | ------------------------------- |
| `attemptId`  | string    | Frozen attempt                  |
| `command`    | string?   | Omitted only for `not-runnable` |
| `outputPath` | path?     | Omitted only for `not-runnable` |
| `selectedAt` | timestamp | Recorded before execution       |
| `notes`      | string?   | Reviewer explanation            |

## EvaluationResult

| Field        | Type     | Rules                                                       |
| ------------ | -------- | ----------------------------------------------------------- |
| `status`     | enum     | `scored`, `not-runnable`, `no-output`, or `execution-error` |
| `exitCode`   | integer? | Present when a process exits                                |
| `stdoutPath` | path?    | Retained execution output                                   |
| `stderrPath` | path?    | Retained execution error                                    |
| `score`      | object?  | Present whenever a candidate output can be read and scored  |
| `error`      | string?  | Operational failure summary                                 |

Model-caused execution failure remains an evaluation result. Host inability to perform declared evaluation is additionally recorded as an infrastructure failure.
