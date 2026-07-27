# Contract: Gate B Qualified Feasibility Decision

## Purpose

The current Gate B artifact records a bounded product decision. It is not a version 1 completed gate report and must not be interpreted as publication-grade empirical evidence.

## Required Fields

- `schemaVersion`: exact supported decision version
- `decisionId`: stable Gate B decision identifier
- `classification`: `qualified-pass`
- `question`: the narrow product question answered
- `profile`: retained material, recognition, and substitution profile
- `acceptedObservation`: instance identity, progress conclusion, and recognition dependency
- `evidenceAvailability`: observation class, replay availability, and limitation
- `authorizes`: next experiment and full-harness flag
- `deferredClaims`: unsupported broader claims

## Invariants

- `acceptedObservation.semanticProgressBeyondMechanical` is `true`.
- `acceptedObservation.sourceRecognitionDependency` is `false`.
- `evidenceAvailability.kind` is `operator-observed`.
- `evidenceAvailability.immutableReplayAvailable` is `false`.
- `authorizes.next` is the minimum Gate C experiment.
- `authorizes.fullHarnessAuthorized` is `false`.
- Deferred claims include non-literary generalization, human comparison, three-role replication, complete identification coverage, and publication-grade replay.

## Claim Boundary

The artifact permits product work on one clock-driven partial-re-key experiment using the retained unrecognized-literary profile. It does not support corpus-general, human-comparative, model-population, or publication-grade claims. A future broader claim requires a new predeclaration and new immutable evidence.
