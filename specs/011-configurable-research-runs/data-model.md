# Data Model: Configurable Research Runs

## Experiment Configuration

Researcher-authored YAML with `schemaVersion: 1`.

### Puzzle Definition

| Field | Type | Rules |
| --- | --- | --- |
| `target.corpus` | identifier | Exists in corpus registry |
| `target.chapters.start/end` | integers | One-based inclusive, `start <= end`, selected range exists |
| `references` | identifier array | Unique, registered, excludes target |
| `seed` | integer | Safe deterministic seed |
| `agentCount` | integer | At least `2` |
| `stageCount` | integer | At least `1` |
| `stageIntervalMs` | integer | Positive |
| `rekeys` | Re-key Definition array | Ordered unique stages |

### Re-key Definition

| Field              | Type    | Rules                                     |
| ------------------ | ------- | ----------------------------------------- |
| `atStage`          | integer | Unique ascending value in `2..stageCount` |
| `changedTokenMass` | number  | Strictly between `0` and `1`              |

### Provider Connection

| Field | Type | Rules |
| --- | --- | --- |
| `driver` | enum | `openai`, `anthropic`, `google`, or `openai-compatible` |
| `apiKeyEnv` | optional string | Required for official drivers; environment-variable name only |
| `baseURL` | optional URL | Required for `openai-compatible` |
| `headersEnv` | optional string map | Header name to environment-variable name; values never persisted |

### Model Profile

| Field             | Type                  | Rules                             |
| ----------------- | --------------------- | --------------------------------- |
| `provider`        | identifier            | Resolves to Provider Connection   |
| `model`           | string                | Nonempty provider model ID        |
| `settings`        | Common Model Settings | Optional, non-secret              |
| `providerOptions` | JSON object           | Optional, non-secret pass-through |

Common settings are optional `maxOutputTokens`, `temperature`, `topP`, and `seed` with finite/range validation.

### Run Condition

| Field         | Type                   | Rules                              |
| ------------- | ---------------------- | ---------------------------------- |
| `name`        | identifier             | Unique within experiment           |
| `model`       | model identifier       | Exactly one of `model` or `agents` |
| `agents`      | model identifier array | Length equals `agentCount`         |
| `repetitions` | integer                | Positive; defaults to `1`          |

## Resolved Experiment

The validated in-memory and persisted non-secret form of Experiment Configuration.

- All defaults are materialized.
- Named references are resolved but stable names are retained.
- Provider credential environment-variable names remain; values do not.
- Agent bindings expand to `{agentId, modelProfile}` for every run condition.
- Run order and repetition ordinals are explicit.
- The resolved value is frozen before any build or attempt side effect.

## Corpus Source

Checked-in provenance record.

| Field                                      | Type               | Rules                         |
| ------------------------------------------ | ------------------ | ----------------------------- |
| `sourceId`                                 | identifier         | Unique                        |
| `path`                                     | safe relative path | Inside repository corpus root |
| `format`                                   | enum               | Initially `gutenberg-text`    |
| `sha256`                                   | digest             | Matches current source bytes  |
| `title`, `author`, provenance URLs/license | strings            | Existing provenance meaning   |

## Puzzle Build v2

| Field | Type | Rules |
| --- | --- | --- |
| `schemaVersion` | integer | Exactly `2` |
| `buildId` | string | Hash of resolved scientific inputs and generated artifacts |
| `source` | resolved source record | Target ID, range, path-independent digest |
| `references` | resolved reference records | IDs and digests |
| `agentIds` | string array | Exactly `agent-1..agent-N` |
| `stageCount` | integer | Positive |
| `stageIntervalMs` | integer | Positive |
| `rekeys` | Re-key Transition array | Matches definition count/order |
| `stages` | Evidence Stage array | `agentCount * stageCount` |
| public/oracle paths | relative paths | Safe inside build root |

### Re-key Transition

| Field              | Type          | Rules                         |
| ------------------ | ------------- | ----------------------------- |
| `atStage`          | integer       | Declared boundary             |
| `keyVersion`       | integer       | One-based transition sequence |
| `changedTokenMass` | number        | Declared target               |
| `changedSymbols`   | string array  | Nonempty, unique, sorted      |
| `keyPath`          | relative path | Host-only derived key         |

### Evidence Stage

| Field                                | Type           | Rules                                  |
| ------------------------------------ | -------------- | -------------------------------------- |
| `agentId`                            | string         | Member of `agentIds`                   |
| `ordinal`                            | integer        | `1..stageCount`                        |
| `keyVersion`                         | integer        | Count of transitions active at ordinal |
| `releaseOffsetMs`                    | integer        | `(ordinal - 1) * stageIntervalMs`      |
| `sourcePath`, `sha256`, `tokenCount` | existing types | Current containment/digest/count rules |

## Model Binding

Non-secret attempt metadata.

| Field             | Type            | Rules                         |
| ----------------- | --------------- | ----------------------------- |
| `profile`         | identifier      | Source profile name           |
| `provider`        | identifier      | Source connection name        |
| `driver`          | provider enum   | Requested direct driver       |
| `requestedModel`  | string          | Configured model ID           |
| `settings`        | object          | Resolved common settings      |
| `providerOptions` | object          | Configured non-secret options |
| `actualProvider`  | optional string | Provider result when supplied |
| `actualModel`     | optional string | Provider result when supplied |

## Attempt Summary v2

Extends the existing durable attempt with:

- `schemaVersion: 2`;
- `buildId`;
- dynamic `agentIds`;
- one Model Binding per session;
- normalized input/output usage per session;
- otherwise unchanged frozen Git, trace, sandbox, and termination records.

The attempt remains durable before optional overlap observation.

## Experiment Summary

Atomically rewritten after each durable attempt.

| Field                  | Type                    | Rules                |
| ---------------------- | ----------------------- | -------------------- |
| `schemaVersion`        | integer                 | Exactly `1`          |
| `resolvedConfig`       | Resolved Experiment     | No credential values |
| `buildRoot`, `buildId` | path/string             | One shared build     |
| `attempts`             | Completed Attempt array | Declaration order    |

Completed Attempt contains `runName`, one-based `repetition`, `attemptId`, and `attemptRoot`. Only durable attempts appear.

## State Transitions

```text
Configuration -> Validated -> Puzzle Built
Puzzle Built -> Attempt Running -> Attempt Durable -> Summary Published
Summary Published -> Next Attempt Running
Attempt Durable -> Reviewer Selected -> Evaluated
Any pre-durable infrastructure failure -> Command Failed
```

A failure never fabricates a successful attempt. A later failure does not remove an earlier durable attempt or the last published experiment summary.
