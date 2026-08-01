# Implementation Plan: Lean Experiment Engine

**Branch**: `feature/022-streamlined-experiment-config` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md)

## Summary

Make one schema-v2 YAML file describe named experimental runs directly. Derive construction and orchestration details, prepare one flat package per realized run regime, preserve strict pre-provider validation, and retain complete run records and traces.

## Technical Context

- TypeScript validates and resolves authored experiments, orchestrates sessions, and stores strict records.
- Python constructs and scores deterministic word-substitution material.
- Local files, append-only JSONL, frozen Git repositories, and Docker preserve the scientific and secret boundaries.
- Vitest and pytest provide fast unit/contract lanes plus explicit material, acceptance, and Docker lanes.

## Contract

1. `ExperimentManifest` schema v2 contains `name`, `models`, and a map of named `runs`.
2. Each run requires source, agent count, uniform model, communication mode, release durations, cutoff, and spend ceiling. Re-key stage and per-agent token limit are optional.
3. Run keys are selectors and artifact IDs. The engine derives agents, credentials, capabilities, package identities and paths, construction inputs, and aggregate authorization.
4. `puzzle:build --config ... [--run ...]` prepares deterministic schema-v2 packages with one flat realization and no references or variants.
5. Validation rejects missing or drifted packages before provider access. Run records freeze resolved milliseconds, source provenance, re-keying, models, capabilities, limits, usage, traces, topology, and evaluation.

## Boundaries

Keep the environment constrained and the workflow model-chosen. Add no roles, turns, checkpoints, consensus, reports, Git procedure, automatic retries, repair, resume state, hosted service, or generic puzzle plugin layer. Runs remain sequential and agents concurrent. Every canonical pushed `main` is graded without best-result selection.

## Verification

- Strict schema and semantic rejection for legacy fields, duplicate keys, malformed durations, unknown models, unsafe paths, invalid geometry, and invalid re-key boundaries.
- Deterministic identity/provenance behavior across source and geometry changes; stationary/re-key pairing retains allocation and pre-boundary evidence.
- No references on agent-visible or stored package surfaces.
- Provider-free TypeScript, Python, material, acceptance, package-build, and exact-validation gates.
