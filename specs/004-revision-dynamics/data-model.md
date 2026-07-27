# Data Model: Revision Dynamics

## Revision Instance

The private, deterministic definition of the two-regime cipher.

| Field                  | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `schemaVersion`        | Contract version, initially `1`                               |
| `instanceId`           | Stable public instance identifier                             |
| `sourceRef`            | Private immutable source artifact reference                   |
| `profileRef`           | Retained stationary-profile reference                         |
| `seedCommitment`       | Public commitment to the sealed seed                          |
| `tokenCount`           | Total retained word-token count                               |
| `switchTokenOffset`    | Private token offset at the chapter boundary                  |
| `preSwitchTokenCount`  | Retained tokens before the switch                             |
| `postSwitchTokenCount` | Retained tokens after the switch                              |
| `chapterRefs`          | Ordered private prepared and public cipher chapter references |
| `stationaryKeyRef`     | Private oracle reference for regime zero                      |
| `revisedKeyRef`        | Private oracle reference for regime one                       |
| `changedEntriesRef`    | Private changed-set and strata reference                      |
| `matchedControlsRef`   | Private stable-control reference                              |
| `publicProjectionRef`  | Solver-visible metadata and cipher references                 |

### Invariants

- Exactly one switch exists and aligns with the boundary between two chapters.
- Both adjacent segments contain at least 10,000 word tokens.
- The two keys have identical domains and codomains and are complete bijections.
- Every selected plaintext type changes image, never maps to itself, and occurs at least eight times on both sides.
- Every unselected plaintext type keeps its prior image.
- Public projection contains no source identity, plaintext, oracle mapping, switch truth, future chapter digest, or sealed seed.

## Changed Entry

| Field               | Meaning                                     |
| ------------------- | ------------------------------------------- |
| `plainType`         | Private plaintext type                      |
| `priorCipherType`   | Regime-zero image                           |
| `revisedCipherType` | Regime-one image                            |
| `preOccurrences`    | Count in the pre-switch segment             |
| `postOccurrences`   | Count in the post-switch segment            |
| `frequencyStratum`  | Deterministic stratum index from `0` to `3` |

## Matched Stable Control

| Field                | Meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| `plainType`          | Private unchanged plaintext type                        |
| `cipherType`         | Stable image in both regimes                            |
| `preOccurrences`     | Count in the pre-switch segment                         |
| `postOccurrences`    | Count in the post-switch segment                        |
| `frequencyStratum`   | Same stratum as its changed entry                       |
| `matchedChangedType` | Private reference to the paired changed type            |
| `distance`           | Absolute difference in normalized post-switch frequency |

Each control is used at most once.

## Reveal Plan

| Field                    | Meaning                                                |
| ------------------------ | ------------------------------------------------------ |
| `schemaVersion`          | Contract version                                       |
| `planId`                 | Stable digest-derived identifier                       |
| `instanceRef`            | Immutable revision-instance reference                  |
| `clock`                  | `monotonic`                                            |
| `startPolicy`            | Operator start plus frozen delay                       |
| `slots`                  | Six ordered reveal slots                               |
| `contradictionThreshold` | Private oracle threshold definition                    |
| `publicProjectionRef`    | Solver-visible schedule without future chapter details |

### Reveal Slot

Each slot contains an ordinal, planned monotonic offset, one or more complete chapter references, cumulative token count, and private cumulative changed-entry contradiction mass.

The runner transitions a slot through:

`planned -> released -> response_started -> checkpoint_recorded`

Any skipped ordinal, duplicate release, partial chapter, or response started before the release event is durable makes the attempt invalid.

## Attempt Lifecycle

`attempt.json` is an immutable start receipt written before the first external call. It binds the declaration digest, run ID, start time, model, pinned environment, and initial running phase.

A successful remote solver run writes `solver-completion.json` and remains nonterminal while deterministic scoring is pending. Scoring writes the trajectory, decision, and replay manifest, then atomically seals `terminal.json`. The terminal manifest binds the container, response chain, classification, and sorted byte-length/SHA-256 references for every other file in the attempt. Failed runner attempts receive a failed terminal manifest. Once `terminal.json` exists, the attempt cannot be reused, appended to, or rescored.

`current.json` is an atomically replaced operator pointer whose status may be `running`, `solver-completed`, `scored`, or `failed`. It is never evidence.

## Solver Checkpoint

| Field                 | Meaning                                              |
| --------------------- | ---------------------------------------------------- |
| `schemaVersion`       | Contract version                                     |
| `attemptId`           | Exact immutable attempt identity                     |
| `ordinal`             | Strictly increasing checkpoint ordinal               |
| `revealOrdinal`       | Latest released slot visible to the solver           |
| `observedMonotonicMs` | Runner observation time                              |
| `responseId`          | Responses API identity                               |
| `previousResponseId`  | Prior response identity or `null`                    |
| `containerId`         | Explicit Code Interpreter container identity         |
| `mappings`            | Ordered claimed cipher-to-plain hypotheses           |
| `switchHypotheses`    | Ordered boundary claims with confidence and evidence |
| `reconstructionRefs`  | Solver-produced reconstruction artifacts             |
| `usage`               | API token and tool-use accounting                    |

### Mapping Hypothesis

A mapping contains cipher type, proposed plaintext type, confidence in `[0,1]`, status (`active`, `retracted`, or `superseded`), supporting revealed chapter ordinals, and a short public rationale or code-artifact reference.

## Revision Trajectory

The deterministic score table derived from ordered checkpoints and the private oracle.

| Field | Meaning |
| --- | --- |
| `checkpointScores` | Changed and matched-control accuracy at every checkpoint |
| `preSwitchGainPp` | Improvement from first checkpoint to best pre-threshold checkpoint |
| `localizedDropPp` | Changed stale-accuracy drop minus stable-control drop |
| `changedRecoveryPp` | Recovery from post-threshold minimum |
| `stableRetentionPp` | Final stable accuracy minus best pre-switch stable accuracy |
| `falseRetractionRate` | Correct stable controls later retracted divided by previously correct controls |
| `prematureAlarmCount` | Switch hypotheses preceding the contradiction threshold |
| `detectionLatencyMs` | First credited correct hypothesis time minus threshold release time |
| `adaptationLatencyMs` | First qualifying recovery time minus credited detection time |
| `integrityFailures` | Ordered validity failures |

Unknown and absent mappings score as incorrect; superseded mappings remain in history.

## Gate C Decision

| State         | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `predeclared` | Inputs, environment, thresholds, and invalidation graph are frozen            |
| `running`     | One exact attempt is receiving scheduled releases                             |
| `invalid`     | Evidence integrity failed; no empirical decision is produced                  |
| `pass`        | Every success predicate holds                                                 |
| `rework`      | Signal exists but one predeclared owning dial needs a new declaration and run |
| `stop`        | Revision is invisible or causes general collapse                              |

A pass sets `gateDAuthorization` to `minimal-only` and `fullHarnessAuthorized` to `false`. Rework names exactly one owning dial. Stop authorizes neither.
