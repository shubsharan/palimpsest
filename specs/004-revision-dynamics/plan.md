# Implementation Plan: Revision Dynamics

**Branch**: `004-revision-dynamics` | **Date**: 2026-07-26 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/004-revision-dynamics/spec.md`

## Summary

Build the reusable Gate C slice needed to decide whether a hidden partial re-key produces selective belief revision. Python derives one chapter-aligned two-regime instance, its changed and frequency-matched stable sets, deterministic scoring, and replay evidence. TypeScript owns a chapter-atomic monotonic reveal runner and records its event stream. Milestones 4–6 integrate these components into the complete offline puzzle harness with fake model adapters. Only after that harness passes may one `gpt-5.6-sol` solver receive released ciphertext through a persistent, network-disabled Code Interpreter container and a chained Responses API conversation.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4  
**Primary Dependencies**: OpenAI Python SDK 2.48.0, JSON Schema, RFC 8785 canonical JSON, spaCy, pnpm 10.14.0, uv  
**Storage**: Canonical JSON and UTF-8 text artifacts under `artifacts/gate-c`, with immutable digest-addressed evidence and one atomic operator pointer  
**Testing**: Vitest 4.1.10, pytest 9.1.1, Hypothesis 6.161.5, cross-runtime golden fixtures, deterministic replay  
**Target Platform**: Local macOS development; evidence-producing Python and Node processes with pinned versions; OpenAI Responses API for the judged solver  
**Project Type**: Dual-runtime research CLI and artifact pipeline  
**Performance Goals**: Generate and replay one 27,504-token instance locally in under 60 seconds; record reveal events before initiating the associated solver request; avoid polling loops faster than one second  
**Constraints**: One hidden switch; at least 10,000 retained word tokens on each side; no solver network; no oracle or future-text exposure; reveal timing independent of solver activity; no live model calls before Milestone 6 passes  
**Scale/Scope**: One retained unrecognized-literary profile, one solver, one six-slot reveal schedule, one judged attempt after calibration  
**Owning Milestone**: Roadmap Milestone 7, Gate C; decide whether the integrated mechanic passes, requires one declared rerun, or stops empirical progression  
**End-to-End Contribution**: Supplies the instance, reveal, solver-adapter, checkpoint, scoring, and replay surfaces integrated by Milestones 4–6  
**Model Execution Policy**: Deterministic fixtures and fake clients only until the Milestone 6 offline-harness completion report passes  
**Trust Boundaries**: Python generation/grading and the TypeScript reveal runner are trusted; the remote solver receives only released ciphertext and public instructions in a network-disabled Code Interpreter container; API credentials stay in the operator environment  
**Contracts/Artifacts**: Version 1 JSON Schemas for the revision instance, reveal plan, reveal event, solver checkpoint, trajectory, and Gate C decision; RFC 8785 canonical bytes; SHA-256 references; immutable attempt directories  
**Replay Claim**: Generation, reveal-plan construction, recorded event ordering, scoring, and the decision recompute exactly from pinned inputs. Model behavior, wall-clock scheduling jitter, remote execution, and reasoning do not replay deterministically.

## Constitution Check

### Pre-research

- **End-to-end before model evaluation**: PASS. The feature's offline components are reusable in the complete harness, and the live attempt remains disabled until Milestone 6 passes.
- **Trust boundaries**: PASS. Oracle data and unreleased chapters remain in the trusted plane; the solver receives no source identity, network, credentials, or future evidence.
- **Contracts and provenance**: PASS. Cross-runtime artifacts use versioned JSON Schemas, canonical bytes, golden fixtures, digest references, and immutable attempt identities.
- **Verification and claims**: PASS. The plan separates deterministic replay from stochastic model behavior and limits a pass to one retained product profile.
- **Native bounded collaboration**: PASS, unaffected. Gate C is intentionally single-solver and does not exercise Git collaboration, accounting, publication slots, or matched communication arms.

## Calibration Decisions

- Select a 27,504-token chapter-complete span from the retained Amber source profile with one internal chapter boundary leaving at least 10,000 tokens on each side.
- Require each changed type to occur at least eight times on both sides of the switch.
- Divide eligible types into four post-switch frequency strata and select changed types deterministically until their post-switch occurrences reach 20% of eligible token mass.
- Pair each changed type with one unchanged control from the same stratum by minimum normalized frequency distance, breaking ties lexicographically.
- Compose the stationary key with a seeded Sattolo derangement over selected ciphertext images. Reject any selection that creates identity or prior-image equality.
- Build six chapter-atomic release slots at equal target fractions of retained tokens. The judged runner uses a two-minute interval on one monotonic clock; tests use an injected clock without weakening production timing.
- Define the contradiction threshold as the first reveal whose cumulative post-switch occurrences of changed types reach 25% of all post-switch changed-type occurrences.
- Record a solver checkpoint after every release response and one final explicit checkpoint. The solver may preserve files and state in one explicit Code Interpreter container, but every scored claim must also appear in the structured checkpoint artifact.
- Keep `gpt-5.6-sol` fixed to preserve continuity with Amber. Offline-harness completion and API capacity are both prerequisites; insufficient quota does not authorize a model substitution.

## Project Structure

### Documentation

```text
specs/004-revision-dynamics/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── gate-c-evidence.md
│   └── solver-protocol.md
└── tasks.md
```

### Source Code

```text
packages/contracts/
├── schemas/
│   ├── revision-instance.schema.json
│   ├── reveal-plan.schema.json
│   ├── reveal-event.schema.json
│   ├── solver-checkpoint.schema.json
│   ├── revision-trajectory.schema.json
│   └── gate-c-decision.schema.json
├── fixtures/
└── src/

python/src/palimpsest/gate_c/
├── artifacts.py
├── config.py
├── instance.py
├── revision.py
├── scoring.py
├── decision.py
└── replay.py

python/tests/gate_c/
├── test_instance.py
├── test_revision.py
├── test_scoring.py
├── test_decision.py
└── test_replay.py

tools/gate-c/
├── config.ts
├── clock.ts
├── reveal-runner.ts
├── solver-runner.ts
├── report.ts
└── replay.ts

tests/gate-c/
├── contracts.test.ts
├── reveal-clock.test.ts
├── solver-runner.test.ts
└── replay.test.ts

artifacts/gate-c/
├── inputs/
├── predeclaration.json
├── instances/
├── attempts/
├── by-digest/
└── current.json
```

**Structure Decision**: Extend the existing dual-runtime boundary. Python owns all corpus, key, oracle, scoring, and decision semantics. TypeScript owns the authoritative live clock, API scheduling, and operator commands. They exchange only schema-validated artifacts and subprocess results; neither runtime duplicates the other's domain rules.

## Phase 0: Research

Resolve the experiment geometry, changed/control selection, reveal cadence, solver continuity, evidence isolation, and replay boundary in [research.md](research.md). No unresolved clarification remains.

## Phase 1: Design and Contracts

Define the entities and state transitions in [data-model.md](data-model.md), the evidence bundle and validity rules in [contracts/gate-c-evidence.md](contracts/gate-c-evidence.md), the solver-visible protocol in [contracts/solver-protocol.md](contracts/solver-protocol.md), and the operator path in [quickstart.md](quickstart.md).

Contracts and failing tests precede behavior. A calibration build may verify geometry and observability without calling the solver. Its outputs cannot be promoted into the judged attempt. The judged attempt binds the declaration digest, instance digest, run ID, model snapshot, explicit container ID, response chain, release events, checkpoints, and final scoring inputs.

## Post-design Constitution Check

- **Evidence before scale**: PASS. The six schemas and two runtime modules are the minimum closed evidence path. Calibration is separated from the single judged attempt.
- **Trust boundaries**: PASS. The solver protocol exposes only released cipher files and public timing/checkpoint instructions. The explicit container uses disabled network policy and contains no trusted package or oracle.
- **Contracts and provenance**: PASS. Every promoted file is reachable from a declaration-bound manifest. `current.json` is only an atomic operator pointer and never evidence.
- **Verification and claims**: PASS. Unit, property, cross-runtime, clock, isolation, scoring, and replay tests are required. A result supports only the one-profile Gate C product decision.
- **Native bounded collaboration**: PASS, unaffected. Gate C creates no repository communication surface and authorizes only minimum Gate D work after a pass.

## Complexity Tracking

No constitution violations require justification.
