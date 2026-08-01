# Feature Specification: Lean Experiment Engine

**Feature Branch**: `feature/022-streamlined-experiment-config` **Created**: 2026-07-31 **Status**: Implemented

## User Story 1 - Describe Named Runs

As a researcher, I edit one small YAML file containing named runs and only the controls that can change the experiment.

Acceptance:

1. The run map key is the identifier accepted by `--run` and stored with artifacts; no separate `id` is authored.
2. Each run declares source, agent count, one model, shared or isolated communication, releases, cutoff, and one spend ceiling.
3. `rekeyAtStage` and `tokenLimitPerAgent` are optional; omission means stationary and unlimited.
4. Legacy construction, assignment, capability, label, credential, output-token, and aggregate-spend fields are rejected.

## User Story 2 - Prepare Deterministic Material

As a researcher, I build all or one named run directly from the experiment config without managing fixture definitions or package paths.

Acceptance:

1. `puzzle:build --config <yaml> [--run <name>]` derives and atomically publishes required packages.
2. Agent IDs, source window, construction randomness, allocation, identity, and paths are deterministic engine-owned values.
3. Source byte or geometry changes alter derived provenance and identity; identical inputs are reproducible.
4. A package contains one flat stationary or re-keyed realization and no references or variant map.
5. Stationary and re-keyed paired construction shares allocation and pre-boundary evidence.

## User Story 3 - Validate and Execute

As a researcher, I validate the exact built experiment and execute its runs without hidden orchestration or duplicated authorization.

Acceptance:

1. Strict `ms`, `s`, `m`, and `h` durations resolve to milliseconds frozen in run records.
2. One model applies uniformly to inferred agents; provider credentials and communication capabilities are inferred.
3. The experiment authorization is the sum of per-run ceilings.
4. Runs execute sequentially in map order; agents within one run execute concurrently.
5. Missing or drifted packages, invalid configuration, failed sandbox/smoke checks, or missing spend authorization stop before provider access.

## User Story 4 - Inspect Complete Evidence

As a researcher or reviewer, I inspect one coherent record and can re-evaluate every frozen canonical origin without rerunning model sessions.

Acceptance:

1. The record freezes resolved source, package identity, re-key boundary, agents, model, communication, milliseconds, limits, spend, usage, releases, topology, and evaluations.
2. Shared runs evaluate one canonical origin; isolated runs evaluate every agent origin without selecting a best result.
3. Missing publication and missing integration remain explicit outcomes.
4. Re-evaluation and overlap analysis append history atomically without altering prior evidence.

## Functional Requirements

- **FR-001**: The authored manifest MUST use `schemaVersion: 2`, `name`, `models`, and a non-empty map of named runs and MUST reject unknown fields and duplicate YAML keys.
- **FR-002**: Run IDs MUST be required unique map keys, human-readable selectors, and not scientific inputs.
- **FR-003**: Every run MUST require source, 2-64 agents, a known model, `shared` or `isolated` communication, non-empty releases, cutoff, and a non-negative safe-integer spend ceiling.
- **FR-004**: Releases and cutoff MUST use strict integer `ms`, `s`, `m`, or `h` durations; releases MUST begin at zero, increase strictly, and finish before the cutoff.
- **FR-005**: `rekeyAtStage`, when present, MUST fit the stage geometry. `tokenLimitPerAgent`, when present, MUST be a positive safe integer.
- **FR-006**: The engine MUST infer ordered agent IDs, uniform model assignments, provider credential environment names, Git/room capabilities, and aggregate authorization.
- **FR-007**: The engine MUST derive source windows, construction randomness, allocation, package identity, and artifact paths from the run and source bytes.
- **FR-008**: Prepared schema-v2 packages MUST contain exactly one realized key regime, resolved provenance and re-key boundary, complete stage geometry, trusted oracle and scoring inputs, and a whole-tree content digest.
- **FR-009**: Reference material MUST be absent from authored configuration, serialized packages, prompts, agent sandboxes, validation, and overlap analysis.
- **FR-010**: The active authored contract MUST NOT expose source bounds, counts, hashes, formats, fixture IDs, package paths, seeds, variants, allocation thresholds, assignments, capability objects, labels, model output-token settings, credential names, or an experiment spend ceiling.
- **FR-011**: Build MUST prepare all unique derived packages or the selected run and MUST never overwrite a non-empty package path.
- **FR-012**: Validation and execution MUST reject missing or drifted packages before provider access.
- **FR-013**: Execution MUST reject missing explicit spend authorization before sandbox work, then repeat exact validation, one sandbox probe, and one representative provider-free smoke before provider access.
- **FR-014**: Runs MUST execute sequentially and sessions within a run concurrently. No failure may trigger retry, replacement, peer cancellation, automated merge, repair, or resume.
- **FR-015**: Git use MUST remain model-chosen and unmetered. Only pushed canonical `main` is checkable and gradeable, and every canonical origin MUST be evaluated without best-result selection.
- **FR-016**: The runner MUST impose no roles, turns, checkpoints, consensus, reports, commit cadence, or coordination procedure.
- **FR-017**: One append-only trace and one atomic run record MUST preserve resolved inputs, observations, topology, infrastructure status, and evaluations while excluding secrets, hidden reasoning, oracle data, keys, references, and unreleased evidence.
- **FR-018**: Re-evaluation and analysis MUST be provider-free, validate frozen evidence before use, and atomically append history without changing earlier evidence.

## Edge Cases

Reject malformed durations, unsafe or unreadable source paths, invalid team sizes, unknown models, invalid re-key boundaries, zero token limits, duplicate YAML run keys, removed legacy fields, missing packages, package drift, and spend sums outside safe-integer range. A trace without `run.json` is interrupted, not complete or resumable.

## Scope

Palimpsest remains a local word-substitution research environment. It does not add a hosted service, generic puzzle framework, automatic statistical conclusions, prescribed collaboration workflow, or claims of reasoning, collaboration value, belief revision, deterministic live behavior, or general benchmark validity.
