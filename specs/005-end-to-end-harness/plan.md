# Implementation Plan: Offline End-to-End Puzzle Harness

**Branch**: `005-end-to-end-harness` | **Date**: 2026-07-26 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/005-end-to-end-harness/spec.md`

## Summary

Build the complete production-shaped Palimpsest lifecycle before making another live model call. Python extends the retained Gate C generation and scoring work into a complete three-shard instance, clean-solver, grader, and replay pipeline. TypeScript adds the run lifecycle, event service, deterministic host-model adapter, reveal daemon, native Git Gateway, publication snapshots, accounting ledgers, freeze, private submission sealing, and operator CLI. One offline command runs three deterministic fixture workers through the same boundaries later used by live agents and emits an immutable completion report authorizing Gate C/D model validation without claiming empirical model behavior.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4; Git 2.48.1  
**Primary Dependencies**: Node standard library, pinned Git CLI, `@palimpsest/contracts`, `@palimpsest/git-accounting`, Python standard library, spaCy, JSON Schema, RFC 8785 canonical JSON; Docker 29.2.1 and digest-pinned images for final isolation verification  
**Storage**: Canonical JSON, UTF-8 text, Git object databases and bundles, append-only NDJSON/event files, immutable attempt directories under `artifacts/harness/`  
**Testing**: Vitest 4.1.10, pytest 9.1.1, Hypothesis 6.161.5, real-Git integration and concurrency tests, hostile solver fixtures, deterministic replay, clean-snapshot verification  
**Target Platform**: One pinned Darwin ARM64 reference host using isolated local processes during unit tests and network-disabled digest-pinned containers for the Milestone 6 completion run  
**Project Type**: Dual-runtime research CLI and single-host orchestration system  
**Performance Goals**: Complete the deterministic fixture lifecycle in under ten minutes; preflight or reject malformed bundles in under thirty seconds; avoid polling loops faster than one second  
**Constraints**: No external model calls; ordinary Git client behavior; one authoritative monotonic clock; one serialized admission sequence; no trusted repair of fixture-agent work; explicit attempt identity; exact output sets; no oracle, future-shard, peer-private, credential, or host-control leakage  
**Scale/Scope**: One retained literary profile, one changing-key instance, three contiguous chapter-aligned shards, three concurrent fixture agents, one publication policy, one clean solver, one scoring policy, one replay and public report  
**Owning Milestone**: Roadmap Milestones 4–6, ending with the offline-harness completion decision  
**End-to-End Contribution**: Generation, preflight, launch, reveal, collaboration, accounting, publication, freeze, submission, clean execution, scoring, replay, redaction, and live-model authorization  
**Model Execution Policy**: Offline deterministic fixture adapter only; production code rejects external-provider adapters until a passing Milestone 6 completion report is explicitly supplied  
**Trust Boundaries**: Python builder/grader/replay, TypeScript coordinator/reveal/event/Git admission, container control, Git object storage, each private shard/output domain, and sealed oracle remain separate; fixture workers and submitted solver code are untrusted  
**Contracts/Artifacts**: Version 1 schema families for instance, run-control, grading/replay, and completion records; RFC 8785 canonical bytes; SHA-256 references; immutable attempts; atomic non-evidentiary operator pointer  
**Replay Claim**: Rebuild, trusted lifecycle transitions, Git admission, published snapshots, ledgers, freeze, solver execution records, scores, redaction, and report digests replay exactly. Fixture process interleaving and operating-system scheduling do not replay, and fixture behavior is not model evidence.

## Constitution Check

### Pre-research

- **End-to-end before model evaluation**: PASS. This feature completes the full offline build-to-report path and prohibits live provider adapters.
- **Trust boundaries**: PASS. The plan preserves separate trusted services, agent-private domains, sealed oracle data, and hostile solver execution.
- **Contracts and provenance**: PASS. Four schema families, cross-runtime fixtures, canonical bytes, immutable inputs, exact outputs, and explicit attempt identity precede behavior.
- **Verification and claims**: PASS. Unit, property, cross-language, real-Git, concurrency, isolation, hostile-solver, end-to-end, and replay evidence are required. The completion report claims integration only.
- **Native bounded collaboration**: PASS. Fixture workers use ordinary Git, the frozen accounting frame, immutable publication slots, and no roles, turns, or server-authored repair.

## Project Structure

### Documentation

```text
specs/005-end-to-end-harness/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── evidence.md
│   └── host-model-bridge.md
└── tasks.md
```

### Source Code

```text
packages/contracts/
├── schemas/
│   ├── instance-records.schema.json
│   ├── run-control-records.schema.json
│   ├── grading-records.schema.json
│   └── offline-harness-report.schema.json
├── fixtures/
└── src/

packages/run-control/
├── src/
│   ├── lifecycle.ts
│   ├── events.ts
│   ├── clock.ts
│   ├── model-bridge.ts
│   ├── coordinator.ts
│   └── submissions.ts
└── tests/

packages/git-gateway/
├── src/
│   ├── policy.ts
│   ├── admission.ts
│   ├── ledger.ts
│   ├── publication.ts
│   ├── fetch.ts
│   └── freeze.ts
└── tests/

python/src/palimpsest/
├── instance_pipeline/
├── solver/
├── grading/
└── replay/

tools/harness/
├── inputs.ts
├── build.ts
├── fixture-worker.ts
├── run.ts
├── grade.ts
├── replay.ts
├── report.ts
└── offline.ts

tests/harness/
├── contracts.test.ts
├── lifecycle.test.ts
├── git-gateway.test.ts
├── isolation.test.ts
├── failure-injection.test.ts
└── end-to-end.test.ts

artifacts/harness/
├── declaration.json
├── attempts/<declaration-digest>/<run-id>/
├── by-digest/
└── current.json
```

**Structure Decision**: Reuse the existing dual-runtime foundation and frozen accounting package. New reusable TypeScript behavior is split between run control and the least-privilege Git Gateway. Python extends existing generation, grading, and Gate C modules rather than duplicating their puzzle semantics. Operator orchestration stays under `tools/harness/`.

## Phase 0: Research

Resolve reuse of the Gate C profile, schema-family boundaries, ordinary Git transport, deterministic fixture-worker semantics, clock injection, container isolation, hostile solver execution, and immutable attempt promotion in [research.md](research.md).

## Phase 1: Design and Contracts

Define lifecycle entities and invariants in [data-model.md](data-model.md), immutable evidence and completion rules in [contracts/evidence.md](contracts/evidence.md), the provider-neutral subprocess boundary in [contracts/host-model-bridge.md](contracts/host-model-bridge.md), and operator verification in [quickstart.md](quickstart.md).

Contracts and failing tests precede implementation. US1 produces an immutable instance accepted by TypeScript preflight. US2 consumes only that bundle and seals a run. US3 consumes only the sealed run and emits replayable private and redacted reports. The root offline command composes those independently testable slices without mutable-pointer discovery.

## Post-design Constitution Check

- **End-to-end before model evaluation**: PASS. The quickstart has no provider credential or live-model command, and the completion report is the sole later authorization input.
- **Trust boundaries**: PASS. Contracts name every visibility projection, private mount, service privilege, and invalidity condition.
- **Contracts and provenance**: PASS. The schema families enumerate exact artifacts and bind every cross-runtime or promoted boundary.
- **Verification and claims**: PASS. Completion requires two independent attempts, failure injection, clean solver rejection, replay equality, and public redaction.
- **Native bounded collaboration**: PASS. The design exercises real Git repositories and clients, serialized admission, per-sender accounting, fixed-slot publication, races, and freeze.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Two new TypeScript packages | Run control and Git admission require different privileges, storage, and failure semantics | A single package would make it easy for the coordinator to mutate repository or ledger state directly, violating the architecture trust boundary |
| Container-backed final verification | Milestone 6 must prove the declared mount and network isolation, not only process behavior | Host-only mocks cannot demonstrate absence of oracle, credential, or unsupported network access |
