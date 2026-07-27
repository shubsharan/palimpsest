# Tasks: Channel Separation

**Input**: Design documents from `specs/002-channel-separation/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/` **Tests**: Required before behavior because this feature changes contracts, accounting, trust boundaries, Git semantics, and empirical gate evidence.

## Phase 1: Setup

**Purpose**: Add only the Gate A package, research module, commands, and verification surfaces authorized by the plan.

- [ ] T001 Add `@palimpsest/git-accounting` workspace metadata and build/test configuration in `packages/git-accounting/package.json` and `packages/git-accounting/tsconfig.json`
- [ ] T002 Add Gate A source, fixture, test, tool, artifact, and Python module directories with boundary readmes or package initializers in `packages/git-accounting/`, `tools/gate-a/`, `tests/gate-a/`, `artifacts/gate-a/`, and `python/src/palimpsest/channel/`
- [ ] T003 Extend root TypeScript aliases, Vitest discovery, and pnpm scripts for Gate A without merging dependency graphs in `tsconfig.json`, `vitest.config.ts`, and `package.json`
- [ ] T004 Extend Python package and test discovery for channel fixtures, codecs, and analysis in `python/pyproject.toml` and `python/src/palimpsest/channel/__init__.py`
- [ ] T005 Update formatting, linting, ignore, and clean-snapshot source selection for Gate A outputs in `package.json`, `.gitignore`, and `tools/evidence/verify-clean-snapshot.ts`

---

## Phase 2: Foundational Contracts and Frozen Inputs

**Purpose**: Establish the versioned JSON evidence authority, exact fixture geometry, and predeclaration builder required by every story.

**Critical**: No accounting, attack, or report implementation begins before these contracts and fixtures exist.

- [ ] T006 [P] Add strict version 1 schemas for Git genesis and logical transactions in `packages/contracts/schemas/git-genesis.schema.json` and `packages/contracts/schemas/logical-git-transaction.schema.json`
- [ ] T007 [P] Add strict version 1 schemas for channel fixtures and useful-state checkpoints in `packages/contracts/schemas/channel-fixture.schema.json` and `packages/contracts/schemas/useful-state-checkpoint.schema.json`
- [ ] T008 [P] Add strict version 1 schemas for relay attempts, timing capacity, and budget sweeps in `packages/contracts/schemas/relay-attempt-result.schema.json`, `packages/contracts/schemas/timing-capacity-result.schema.json`, and `packages/contracts/schemas/budget-sweep-result.schema.json`
- [ ] T009 Register Gate A schema identifiers without changing Milestone 1 schema semantics in `packages/contracts/src/schema-registry.ts` and `python/src/palimpsest/contracts/schemas.py`
- [ ] T010 [P] Add accepted and rejected cross-runtime Gate A JSON fixtures in `packages/contracts/fixtures/valid/`, `packages/contracts/fixtures/invalid/`, and `packages/contracts/fixtures/manifest.json`
- [ ] T011 [P] Write cross-runtime schema-version, unknown-field, unsafe-count, digest, and canonical-byte tests in `tests/contract/cross-runtime.test.ts` and `python/tests/test_contracts.py`
- [ ] T012 Replace the historical exact-five-schema live assertion with milestone-scoped compatibility assertions in `tests/contract/foundation-boundaries.test.ts`
- [ ] T013 Define the immutable Gate A input manifest, common-side-information inventory, geometry matrix, strategy matrix, useful-state workload, timing model, and 4–64 KiB sweep in `artifacts/gate-a/inputs/input-manifest.json`
- [ ] T014 Implement the Gate A predeclaration builder and drift checker over contracts, source, tools, fixtures, and exact environment in `tools/gate-a/report.ts`
- [ ] T015 Validate Phase 2 with `pnpm contracts:compare`, schema coverage, fixture coverage, version checks, and a predeclaration tamper probe recorded in `tests/gate-a/evidence-replay.test.ts`

**Checkpoint**: Shared schemas, frozen inputs, and a valid unjudged Gate A predeclaration are ready.

---

## Phase 3: User Story 1 - One Logical Git State, One Charge (Priority: P1)

**Goal**: Produce one injective, pack-independent frame and charge for each permitted real logical Git transaction.

**Independent Test**: Materialize equivalent native Git transactions under every pack variation, require identical frames, then mutate every peer-visible field and require a changed frame or explicit rejection.

### Verification for User Story 1

- [ ] T016 [P] [US1] Write accepted and rejected binary golden-vector tests from the frame contract in `packages/git-accounting/tests/codec.test.ts`
- [ ] T017 [P] [US1] Write property tests for decode/re-encode identity, truncation, trailing bytes, ordering, duplicates, overflow, and OID recomputation in `packages/git-accounting/tests/codec.property.test.ts`
- [ ] T018 [P] [US1] Write real Git reachability, fast-forward, path/mode, unreachable-object, and journal-set tests in `packages/git-accounting/tests/transaction.test.ts`
- [ ] T019 [P] [US1] Write peer-visible field mutation probes for refs, commits, trees, blobs, metadata, topology, and object selection in `packages/git-accounting/tests/mutation.test.ts`
- [ ] T020 [P] [US1] Write same-slot duplicate exposure and slot-start visibility property tests in `tests/gate-a/same-slot-visibility.test.ts`
- [ ] T021 [P] [US1] Write native pack-order, compression, delta, thin-pack, repack, and supported-client equivalence tests in `tests/gate-a/pack-invariance.test.ts`

### Implementation for User Story 1

- [ ] T022 [US1] Implement bounded big-endian binary readers, writers, enums, and exact length accounting in `packages/git-accounting/src/binary.ts`
- [ ] T023 [US1] Implement `GitAccountingFrameV1` encode, decode, validation, and charge calculation in `packages/git-accounting/src/codec.ts`
- [ ] T024 [US1] Implement Git SHA-256 OID recomputation and exact commit/tree/blob logical parsing in `packages/git-accounting/src/git-objects.ts`
- [ ] T025 [US1] Implement writable ref grammar, create/update rules, fast-forward validation, modes, normalized paths, and forbidden surfaces in `packages/git-accounting/src/policy.ts`
- [ ] T026 [US1] Implement reachable-closure subtraction and exact newly-visible object validation in `packages/git-accounting/src/transaction.ts`
- [ ] T027 [US1] Implement immutable slot-start visibility journals and same-slot union semantics in `packages/git-accounting/src/visibility.ts`
- [ ] T028 [US1] Export the reviewed accounting API and version constants in `packages/git-accounting/src/index.ts`
- [ ] T029 [US1] Generate canonical accepted and rejected frame binaries plus source manifests in `packages/git-accounting/fixtures/`
- [ ] T030 [US1] Implement the native SHA-256 Git repository, plumbing, pack-variation, and transaction reconstruction driver in `tools/gate-a/native-git.ts`
- [ ] T031 [US1] Record User Story 1 golden-vector, mutation, closure, same-slot, and pack-invariance evidence in `artifacts/gate-a/raw/accounting-verification.json`

**Checkpoint**: The exact accounting codec is independently usable and real-Git invariant before any capacity claim.

---

## Phase 4: User Story 2 - Strongest Tested Relay Outside Useful Budget (Priority: P2)

**Goal**: Measure exact cumulative frame frontiers for complete-shard relay and faithful evolving belief across frozen geometries and side information.

**Independent Test**: Decode every relay and useful-state attempt, accept only exact semantic reconstruction, materialize its full cumulative Git state, and recompute the predeclared sweep including conservative timing capacity.

### Verification for User Story 2

- [ ] T032 [P] [US2] Write deterministic normalization, opaque-token geometry, provenance, and source-boundary property tests in `python/tests/test_channel_fixtures.py`
- [ ] T033 [P] [US2] Write round-trip and corruption tests for raw, token, Huffman, Deflate, dictionary, bzip2, LZMA, Brotli, Zstandard, delta, and custom-codebook strategies in `python/tests/test_channel_codecs.py`
- [ ] T034 [P] [US2] Write semantic equality tests for all four useful-state checkpoints and optimized encodings in `python/tests/test_useful_state.py`
- [ ] T035 [P] [US2] Write exact-reconstruction, cumulative-charge, extrema, timing-credit, and sweep-classification tests in `python/tests/test_gate_a_analysis.py`
- [ ] T036 [P] [US2] Write real-Git materialization and exact frame-sum integration tests for relay and useful attempts in `tests/gate-a/relay-materialization.test.ts`
- [ ] T037 [P] [US2] Write exhaustive peer-visible channel-surface coverage tests and residual-channel failure checks in `tests/gate-a/channel-surface.test.ts`

### Implementation for User Story 2

- [ ] T038 [US2] Implement license/provenance-bound source normalization and opaque-token shard geometry construction in `python/src/palimpsest/channel/fixtures.py`
- [ ] T039 [US2] Implement fixed-width, varint, canonical Huffman, and sparse/complete dictionary codecs with exact decoders in `python/src/palimpsest/channel/codecs.py`
- [ ] T040 [US2] Implement pinned Deflate, dictionary Deflate, bzip2, LZMA/XZ, Brotli, Zstandard, and reference-delta strategies with input-access manifests in `python/src/palimpsest/channel/compressors.py`
- [ ] T041 [US2] Implement the four-version faithful useful-state semantic fixture and competing encodings in `python/src/palimpsest/channel/useful_state.py`
- [ ] T042 [US2] Acquire, normalize, license, digest, and freeze the predeclared source/reference/common-input artifacts in `artifacts/gate-a/inputs/`
- [ ] T043 [US2] Implement fresh network-disabled codec subprocess attempts and exact decoder verification through the Milestone 1 runner in `tools/gate-a/relay-runner.ts`
- [ ] T044 [US2] Implement accepted Git history strategies for blobs, metadata, paths, topology, visible-object selection, branches, and cumulative split updates in `tools/gate-a/git-strategies.ts`
- [ ] T045 [US2] Implement faithful useful-state real-Git materialization and cumulative checkpoint charging in `tools/gate-a/useful-state.ts`
- [ ] T046 [US2] Implement the 120-slot push-presence bound and measured residual transport capacity result in `tools/gate-a/timing-capacity.ts`
- [ ] T047 [US2] Implement exact reconstruction, per-geometry extrema, capacity credit, 4–64 KiB classification, and adjacent-point analysis in `python/src/palimpsest/channel/analysis.py`
- [ ] T048 [US2] Implement judged matrix orchestration with predeclaration/environment drift refusal and atomic evidence promotion in `tools/gate-a/sweep.ts`
- [ ] T049 [US2] Produce digest-addressed relay, useful-state, timing, sweep-table, sensitivity, and plot artifacts in `artifacts/gate-a/raw/`

**Checkpoint**: Every frozen attack and useful workload has an exact reconstruction verdict and cumulative production-frame charge.

---

## Phase 5: User Story 3 - A Predeclared Decision Governs What May Be Built (Priority: P3)

**Goal**: Complete and independently replay a Gate A pass, rework, or stop decision without changing frozen inputs or authorizing the full harness.

**Independent Test**: Resolve all report artifacts by digest and independently recompute frames, reconstruction verdicts, timing credit, sweep points, interval, result, invalidations, and authorization from the predeclaration and raw outputs.

### Verification for User Story 3

- [ ] T050 [P] [US3] Write predeclaration input/threshold tamper, environment drift, missing artifact, and invalid transition tests in `tests/gate-a/evidence-replay.test.ts`
- [ ] T051 [P] [US3] Write independent raw-artifact resolution and full decision recomputation tests in `tests/gate-a/report-replay.test.ts`
- [ ] T052 [P] [US3] Write pass, rework, stop, integrity-invalid, and downstream-authorization fixtures in `packages/contracts/fixtures/`

### Implementation for User Story 3

- [ ] T053 [US3] Complete Gate A reporting with raw digest references, metrics, extrema, interval, limitations, result, follow-up, and invalidations in `tools/gate-a/report.ts`
- [ ] T054 [US3] Implement a read-only independent Gate A replay command in `tools/gate-a/replay.ts`
- [ ] T055 [US3] Generate and validate `artifacts/gate-a/gate-report.json` without mutating its predeclared projection
- [ ] T056 [US3] Record the proceed/rework/stop decision, frozen interval if any, invalidated evidence, residual attacks, and full-harness authorization `false` in `artifacts/gate-a/milestone-report.json`

**Checkpoint**: Gate A has a citable decision and exact follow-up boundary.

---

## Phase 6: Polish and Gate Exit

**Purpose**: Reconcile docs, validate reviewer instructions, and close every claimed verification surface.

- [ ] T057 [P] Update Gate A implementation and roadmap status with evidence-backed current-state language in `specs/002-channel-separation/spec.md` and `docs/roadmap.md`
- [ ] T058 [P] Update the architecture verification traceability only where concrete commands or artifacts now exist in `docs/architecture.md`
- [ ] T059 Validate every command and expected failure in `specs/002-channel-separation/quickstart.md`
- [ ] T060 Run `pnpm verify`, a fresh offline clean-snapshot verification, Gate A replay, digest resolution, `git diff --check`, untracked whitespace checks, and Markdown structure checks
- [ ] T061 Inspect the complete diff for premature gateway/harness code, undeclared dependencies, trust-boundary drift, and unsupported empirical claims

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts after the passing Milestone 1 report.
- **Foundational (Phase 2)**: Depends on setup and blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Phase 2 and supplies the production charge used everywhere else.
- **User Story 2 (Phase 4)**: Depends on the verified User Story 1 codec and frozen Phase 2 inputs.
- **User Story 3 (Phase 5)**: Depends on judged User Story 2 raw artifacts.
- **Polish (Phase 6)**: Depends on the completed Gate A decision.

### User Story Dependency Graph

```text
Setup -> Contracts and frozen inputs -> US1 exact accounting -> US2 capacity sweep -> US3 gate decision -> Exit
```

The stories are ordered because later stories consume evidence from earlier ones, but each has an independent test surface: codec correctness, capacity measurement, and report replay.

### Parallel Opportunities

- T006-T008 can proceed in parallel across disjoint schema groups.
- T010-T011 can proceed after schemas while T013-T014 prepare frozen input and predeclaration tooling.
- T016-T021 are parallel failing verification surfaces before codec implementation.
- T022-T027 separate binary, object, policy, transaction, and visibility modules after their interfaces settle.
- T032-T037 are parallel failing verification surfaces for the attack harness.
- T038-T041 implement disjoint Python fixture/codec/useful modules in parallel; T043-T046 implement disjoint TypeScript orchestration surfaces.
- T050-T052 independently cover replay, state transitions, and contract fixtures.
- T057-T058 are parallel documentation reconciliation tasks.

## Implementation Strategy

### MVP: Exact Accounting First

1. Complete Phases 1-2.
2. Deliver User Story 1 with reviewed golden vectors and real-Git invariance.
3. Stop if any accepted peer-visible mutation is unmeasured or pack representation changes the charge.

### Incremental Gate Delivery

1. Freeze schemas and inputs before behavior.
2. Prove the frame over real Git before measuring compressors.
3. Add the full predeclared attack/useful matrix without changing its decision rule.
4. Complete and replay the report.
5. Proceed only according to pass/rework/stop; never start the live gateway here.

## Notes

- `[P]` means different files and no dependency on another incomplete task.
- Every judged artifact is produced only after a valid predeclaration.
- Exact reconstruction and exact production-frame charge are required; payload, compressor, or pack byte sizes are diagnostic.
- A failed Gate A is a valid research result. Accounting omissions and evidence drift are invalid runs, not rework evidence.
