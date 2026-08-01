# Implementation Plan: Lean Experiment Engine

**Branch**: `feature/021-lean-experiment-engine` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/021-lean-experiment-engine/spec.md`

## Summary

Replace the frozen five-block study platform with one direct path from declarative fixture definitions, through prepared deterministic fixture packages and explicit ordered experiment runs, to normalized run records. Preserve the puzzle mechanics, provider-neutral concurrent sessions, communication isolation, Docker boundaries, published-main checking, complete canonical-origin evaluation, and safe behavioral trace. Remove study phases, fixed conditions, reservations, replacement/recovery state, and receipt-bound preflight; validate the exact configuration and fixture packages immediately before execution instead.

## Technical Context

**Language/Version**: TypeScript 7.0 on Node.js 26.5; Python 3.12.4  
**Primary Dependencies**: AI SDK provider adapters, Ajv, YAML, Zod; Python standard library and RFC 8785 canonical JSON  
**Storage**: Trusted local files, prepared fixture-package directories, append-only JSONL traces, frozen Git repositories/workspaces, and atomically published JSON records  
**Testing**: Vitest 4.1 named unit/contract/acceptance/Docker projects, pytest 9.1 unit/contract/material markers, deterministic fake clocks/model adapters, Git contract tests, and explicit local Docker sandbox tests

**Target Platform**: Local macOS/Linux operator host with Linux agent and evaluator containers

**Project Type**: Local CLI and deterministic research toolkit  
**Performance Goals**: Validation completes before any provider request; runs start sequentially without overlap; agents inside one run start concurrently; fixture preparation and scoring remain deterministic for fixed inputs  
**Constraints**: No hosted service, database, automatic retry/recovery, arbitrary puzzle plugin system, credential persistence, oracle exposure, hidden-reasoning capture, or prescribed agent workflow  
**Scale/Scope**: Explicit local experiment lists over prepared word-substitution fixtures; tested geometries include 2 agents/3 stages, the existing 3 agents/6 stages, and 4 agents/8 stages  
**Puzzle Contribution**: Researchers can vary genuine puzzle geometry, evidence, key variants, communication, timing, and model assignments through declarations instead of code edits  
**Agent Instructions & Tools**: Preserve the shared objective, stable team identity, cipher family, ordinary tools, target-excluded references, communication surface, assigned Git origin, aggregate published-main checker, and `python3 solver.py` grading interface; impose no role, turn, checkpoint, report, branch workflow, or coordination sequence  
**Environmental Constraints**: Freeze each run's releases and cutoffs; keep trusted fixture content outside agent workspaces; expose ordinary peer Git and optional room only in shared runs; keep isolated Git private; retain sandbox, network, and credential boundaries  
**Observable Outcomes**: Retain responses and safe returned summaries, tool/checker/Git/room activity, releases, usage, termination, frozen topology, every canonical-origin evaluation, explicit infrastructure failures, and optional post-publication overlap observations  
**Determinism Claim**: Definition resolution, fixture construction, manipulation checks, stage bytes, published-commit capture, solver execution, and scoring reproduce for fixed inputs; provider behavior, scheduling interleavings, Git choices, collaboration, and reviewer interpretation do not

## Constitution Check

_GATE: Evaluated before research and re-evaluated after design._

- **Puzzle behavior before process — PASS**: The design changes configurable inputs and records, not the agent-created solving process.
- **Environmental constraints, not workflow — PASS**: Run declarations constrain visibility, schedule, resources, and the canonical solver only.
- **Minimal reproducible mechanics — PASS**: Four domain records replace the current study receipt, phase, reservation, adjustment, replacement, and recovery schema family.
- **Observe outcomes honestly — PASS**: Failures, missing publication, non-integration, workarounds, and every origin result remain explicit rather than selected or repaired.
- **Condition-defined native collaboration — PASS**: Communication is a direct per-run condition; paired runs can keep every other resolved input identical, and Git remains ordinary, unmetered, and model-chosen.
- **Risk-aligned verification — PASS**: Constitution 7.0.0 requires immediate validation of the exact experiment manifest, fixture digests, sandbox behavior, provider-free smoke path, and explicit spend authorization before provider access.

Post-design review reaches the same result: the data and CLI contracts do not prescribe agent process or add speculative infrastructure. The focused verification amendment is ratified in Constitution 7.0.0.

## Project Structure

### Documentation (this feature)

```text
specs/021-lean-experiment-engine/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── data.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── cli.ts
├── experiment/              # manifest contracts, validation, ordered execution
├── fixture/                 # build, package decoder, provider-free smoke model
├── run/                     # execution, runtime, record, session, releases, tools
├── evaluation/              # evaluator, overlap, checker, published solver
├── model/                   # provider-neutral contracts and AI SDK adapter
├── sandbox/
└── git.ts, trace.ts, canonical.ts, seal.ts, python.ts, process.ts, flags.ts
python/
├── pyproject.toml
├── uv.lock
├── palimpsest/
│   ├── puzzle/              # definition, design/allocation, package, build, primitives
│   └── evaluation/
└── tests/
experiments/                 # research-authored declarations
fixtures/                    # provenance-pinned corpus inputs
tests/                       # cross-boundary TypeScript tests
```

**Structure Decision**: Keep the existing single TypeScript application and root-level Python research project. Reorganize within those language boundaries, use explicit imports without barrel files, and delete obsolete modules rather than introducing packages, workspaces, services, databases, or compatibility layers.

## Implementation Approach

1. Amend the verification governance and define strict decoders for `FixtureDefinition`, `FixturePackage`, `ExperimentManifest`, and `RunRecord`; serialized values use `schemaVersion: 1` while code names remain unversioned.
2. Generalize Python construction around declared agent/stage geometry, variants, boundaries, and allocation constraints; publish prepared packages atomically with one digest over the canonical manifest and every regular package file.
3. Replace the study planner with manifest-order execution. Resolve one run, validate its exact fixture and resource relationships, smoke-test the selected run when requested, then run independent concurrent agent sessions using the declared communication topology.
4. Collapse durable attempt/study artifacts into an atomic run record plus append-only trace. Freeze first, structurally validate the canonical trace, evaluate every canonical origin, publish only complete records, and allow later evaluation/analysis results to be appended through atomic record replacement after fixture and trace drift checks.
5. Express the historical five-block matrix as example declarations, remove compatibility and orchestration infrastructure, then rewrite active documentation around the scientific flow.
6. Split repository verification by cost and evidence: bounded-parallel static/unit/host-contract feedback in advisory CI; local material, deterministic acceptance, and real-container tiers; and exact one-smoke experiment validation only at the provider-access boundary. Give each invariant one language/layer owner, remove duplicate fixture and transitional architecture checks, and require test-owned resource cleanup.

## Governance Change

| Change | Current Experimental Need | Simpler Observation Rejected Because |
| --- | --- | --- |
| Replace constitution section requiring a clean revision-bound preflight receipt | Experiments must vary manifests and prepared fixtures as genuine run inputs while validating what will actually execute | Keeping the receipt retains source/commit ceremony and stale-receipt machinery that does not validate fixture selection or experimental relationships; removing the gate entirely would permit spend before sandbox and provider-free checks |
| Layer repository verification and keep consequential checks local | Fast behavioral feedback is needed on ordinary changes without confusing it with exact experiment readiness or empirical evidence | One all-inclusive suite silently requires Docker and rebuilds scientific material on every edit; CI with no tests misses behavior; CI with every tier violates the consequence boundary and wastes time |
