# Tasks: Offline End-to-End Puzzle Harness

**Input**: Design documents from `/specs/005-end-to-end-harness/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Verification**: Tests precede behavior and include every applicable unit, property, cross-language, real-Git, concurrency, lifecycle, isolation, hostile-solver, end-to-end, redaction, and replay check.

## Phase 1: Setup

**Purpose**: Add the harness module surfaces and offline commands without starting a run.

- [x] T001 Create `packages/run-control/`, `packages/git-gateway/`, `python/src/palimpsest/instance_pipeline/`, `python/src/palimpsest/solver/`, `python/src/palimpsest/replay/`, `tools/harness/`, `tests/harness/`, and `python/tests/harness/`
- [x] T002 Add `harness:inputs`, `harness:build`, `harness:predeclare`, `harness:predeclare:check`, `harness:run:offline`, `harness:grade`, `harness:replay`, `harness:complete`, and `harness:offline` scripts to `package.json`
- [x] T003 [P] Pin Git, Docker, fixture-image, solver-image, and harness producer versions in `.tool-versions`, `tools/evidence/verify-versions.ts`, and `tools/harness/config.ts`
- [x] T004 [P] Define offline model-provider prohibition and adapter authorization configuration in `packages/run-control/src/model-bridge.ts` and `tools/harness/config.ts`
- [x] T005 Define immutable harness paths, declaration inputs, attempt identity, and atomic operator pointer policy in `tools/harness/config.ts` and `python/src/palimpsest/instance_pipeline/config.py`

---

## Phase 2: Foundational Contracts and Provenance

**Purpose**: Establish every cross-runtime and promoted boundary before instance or run behavior.

- [x] T006 Add version 1 schema families in `packages/contracts/schemas/instance-records.schema.json`, `packages/contracts/schemas/run-control-records.schema.json`, `packages/contracts/schemas/grading-records.schema.json`, and `packages/contracts/schemas/offline-harness-report.schema.json`
- [x] T007 Register every harness record ID in `packages/contracts/src/schema-registry.ts` and `python/src/palimpsest/contracts/schemas.py`
- [x] T008 [P] Add valid and invalid harness fixtures and manifest entries under `packages/contracts/fixtures/`
- [x] T009 [P] Add TypeScript schema-family parity tests in `tests/harness/contracts.test.ts`
- [x] T010 [P] Add Python schema-family parity tests in `python/tests/harness/test_contracts.py`
- [x] T011 Add declaration-digest/run-ID immutable attempt helpers and exact terminal output manifests in `tools/harness/artifacts.ts`
- [x] T012 [P] Add attempt isolation, terminal immutability, pointer independence, and exact-output tests in `tests/harness/artifacts.test.ts`
- [ ] T013 Define lifecycle, event, clock, host-bridge, Git Gateway, submission, grader, and replay interfaces in `packages/run-control/src/types.ts` and `packages/git-gateway/src/types.ts`
- [x] T014 Add foundational package exports and build configuration in `packages/run-control/package.json`, `packages/run-control/tsconfig.json`, `packages/git-gateway/package.json`, and `packages/git-gateway/tsconfig.json`

**Checkpoint**: Both runtimes agree on all harness records, and no mutable or partial output can become evidence.

---

## Phase 3: User Story 1 - Build One Playable Puzzle Bundle (Priority: P1)

**Goal**: Produce one deterministic, replayable three-shard instance bundle accepted directly by runtime preflight.

**Independent Test**: Build the same frozen request twice, compare every byte and digest, then validate each public, agent-private, trusted, and sealed projection from TypeScript.

### Verification for User Story 1

- [x] T015 [P] [US1] Add complete-instance determinism, three-shard geometry, key, switch, reveal, and manifest property tests in `python/tests/harness/test_instance_pipeline.py`
- [x] T016 [P] [US1] Add reference-corpus duplicate screening and entity-regeneration consistency tests in `python/tests/harness/test_reference_corpus.py`
- [x] T017 [P] [US1] Add public and per-agent visibility leakage tests in `python/tests/harness/test_visibility.py`
- [x] T018 [P] [US1] Add Python-producer to TypeScript-preflight round-trip and tamper tests in `tests/harness/instance-preflight.test.ts`
- [x] T019 [P] [US1] Add fresh-attempt build isolation and undeclared-output rejection tests in `tests/harness/build-isolation.test.ts`

### Implementation for User Story 1

- [x] T020 [P] [US1] Implement retained source, entity review, reference-corpus, and structural dedup assembly in `python/src/palimpsest/instance_pipeline/corpus.py`
- [x] T021 [P] [US1] Implement three contiguous chapter-aligned shards and per-agent progressive releases in `python/src/palimpsest/instance_pipeline/shards.py`
- [x] T022 [US1] Generalize stationary and partial-rekey generation from Gate C in `python/src/palimpsest/instance_pipeline/instance.py`
- [x] T023 [US1] Emit public, reference, private-shard, reveal, difficulty, scoring, and sealed-oracle projections in `python/src/palimpsest/instance_pipeline/bundle.py`
- [x] T024 [US1] Implement exact declared output promotion and bundle identity in `python/src/palimpsest/instance_pipeline/artifacts.py`
- [x] T025 [US1] Implement schema-only runtime preflight and visibility checks in `tools/harness/preflight.ts`
- [x] T026 [US1] Implement retained-input verification and deterministic build commands in `tools/harness/inputs.ts` and `tools/harness/build.ts`
- [x] T027 [US1] Emit and check the frozen offline harness declaration in `tools/harness/report.ts`

**Checkpoint**: One production-shaped instance bundle rebuilds identically and crosses the Python/TypeScript boundary without conversion logic.

---

## Phase 4: User Story 2 - Complete One Production-Shaped Offline Run (Priority: P2)

**Goal**: Run three concurrent fixture workers through reveal, native Git, accounting, publication, freeze, finalization, and private submission.

**Independent Test**: Launch the US1 bundle with a deterministic clock and local smart Git transport, then reconcile the sealed ref map, events, snapshots, ledgers, releases, resources, and private deliverables.

### Verification for User Story 2

- [ ] T028 [P] [US2] Add legal and illegal lifecycle transition, common-barrier, deadline, drain, freeze, and terminal tests in `packages/run-control/tests/lifecycle.test.ts`
- [ ] T029 [P] [US2] Add hash-chain, idempotency, gap, reorder, duplicate-effect, crash-boundary, and recovery tests in `packages/run-control/tests/events.test.ts`
- [ ] T030 [P] [US2] Add absolute reveal/publication clock, tolerance, and agent-independence tests in `packages/run-control/tests/clock.test.ts`
- [ ] T031 [P] [US2] Add fixture subprocess NDJSON, timeout, resource, undeclared-file, provider-prohibition, and adapter-authorization tests in `packages/run-control/tests/model-bridge.test.ts`
- [ ] T032 [P] [US2] Add authenticated namespace, ref, object, path, capability, quarantine, and fast-forward policy tests in `packages/git-gateway/tests/policy.test.ts`
- [ ] T033 [P] [US2] Add exact accounting frame, reservation, idempotency, one-byte-over-budget, duplicate-object, and sender-attribution tests in `packages/git-gateway/tests/admission.test.ts`
- [x] T034 [P] [US2] Add competing push, independent branch, disconnect-after-admission, and crash-consistency tests in `packages/git-gateway/tests/concurrency.test.ts`
- [ ] T035 [P] [US2] Add immutable publication snapshot, canonical fetch tuple, no-intermediate-ref, and freeze-race tests in `packages/git-gateway/tests/publication.test.ts`
- [x] T036 [P] [US2] Add private shard, future reveal, peer output, oracle, credential, and host-control isolation tests in `tests/harness/isolation.test.ts`
- [x] T037 [P] [US2] Add three-worker native clone/fetch/pull/commit/merge/push workflow tests in `tests/harness/native-git.test.ts`

### Implementation for User Story 2

- [x] T038 [P] [US2] Implement the frozen lifecycle state machine in `packages/run-control/src/lifecycle.ts`
- [ ] T039 [P] [US2] Implement the durable hash-chained event append service in `packages/run-control/src/events.ts`
- [ ] T040 [P] [US2] Implement system and deterministic monotonic clocks and schedules in `packages/run-control/src/clock.ts`
- [ ] T041 [US2] Implement fixture subprocess launch, NDJSON validation, quota measurement, timeout, and terminal sealing in `packages/run-control/src/model-bridge.ts`
- [x] T042 [P] [US2] Implement agent-private release mount projection in `packages/run-control/src/reveal.ts`
- [x] T043 [P] [US2] Implement private deliverable sealing and visibility enforcement in `packages/run-control/src/submissions.ts`
- [ ] T044 [US2] Implement ref/object/path/capability policy and quarantine validation in `packages/git-gateway/src/policy.ts`
- [ ] T045 [US2] Implement serialized transactional admission using `GitAccountingFrameV1` in `packages/git-gateway/src/admission.ts`
- [x] T046 [US2] Implement cumulative per-agent reservations and ledgers in `packages/git-gateway/src/ledger.ts`
- [x] T047 [US2] Implement immutable fixed-slot snapshots and visibility journaling in `packages/git-gateway/src/publication.ts`
- [ ] T048 [US2] Implement snapshot-gated canonical fetch serving in `packages/git-gateway/src/fetch.ts`
- [ ] T049 [US2] Implement push closure, drain reconciliation, Git bundle creation, and freeze in `packages/git-gateway/src/freeze.ts`
- [x] T050 [US2] Implement authenticated local smart-HTTP Git transport in `tools/harness/git-server.ts`
- [x] T051 [US2] Implement deterministic native-Git fixture worker behavior in `tools/harness/fixture-worker.ts`
- [ ] T052 [US2] Implement the common-barrier coordinator across reveal, workers, Git Gateway, quotas, freeze, and submissions in `packages/run-control/src/coordinator.ts`
- [x] T053 [US2] Implement explicit-attempt offline run orchestration and live event streaming in `tools/harness/run.ts`

**Checkpoint**: A sealed offline run reaches `SUBMITTED` with real Git evidence, exact ledgers, one freeze identity, and three private deliverables.

---

## Phase 5: User Story 3 - Grade, Replay, and Publish the Offline Run (Priority: P3)

**Goal**: Convert the sealed run into deterministic clean-solver, score, replay, and redacted report evidence.

**Independent Test**: Grade and replay one explicit US2 attempt from sealed inputs, then regenerate identical private and public report digests without reading mutable pointers.

### Verification for User Story 3

- [x] T054 [P] [US3] Add archive traversal, links, devices, sparse entries, duplicates, collisions, undeclared files, and entry/byte bomb tests in `python/tests/harness/test_solver_bundle.py`
- [x] T055 [P] [US3] Add valid non-Python clean-solver execution, timeout, network, mount, and exact-output tests in `python/tests/harness/test_solver_execution.py`
- [x] T056 [P] [US3] Add reconstruction, entity, dictionary, changed/stable, switch, latency, collaboration, and confidence formula tests in `python/tests/harness/test_scoring.py`
- [x] T057 [P] [US3] Add ref, object, snapshot, visibility, ledger, event, freeze, solver, score, and report replay tests in `python/tests/harness/test_replay.py`
- [x] T058 [P] [US3] Add public report redaction and narrow-claim tests in `python/tests/harness/test_public_report.py`
- [x] T059 [P] [US3] Add exact-attempt TypeScript/Python replay parity and tamper tests in `tests/harness/replay.test.ts`
- [x] T060 [P] [US3] Add build-to-report, zero-provider-call, and second-attempt isolation tests in `tests/harness/end-to-end.test.ts`

### Implementation for User Story 3

- [x] T061 [P] [US3] Implement hostile archive inspection and filtered staging in `python/src/palimpsest/solver/bundle.py`
- [x] T062 [US3] Implement network-disabled clean executable invocation and exact output collection in `python/src/palimpsest/solver/executor.py`
- [x] T063 [P] [US3] Complete versioned score formulas and report assembly in `python/src/palimpsest/grading/score_report.py`
- [x] T064 [US3] Implement trusted run-state and score replay in `python/src/palimpsest/replay/harness.py`
- [x] T065 [US3] Implement redacted public report projection in `python/src/palimpsest/replay/public_report.py`
- [x] T066 [US3] Implement explicit-attempt grading orchestration in `tools/harness/grade.ts`
- [x] T067 [US3] Implement explicit-attempt replay orchestration in `tools/harness/replay.ts`
- [x] T068 [US3] Implement completion predicates, promotion, and live-model authorization decision in `tools/harness/report.ts`
- [x] T069 [US3] Implement the composed no-provider build-to-report command in `tools/harness/offline.ts`

**Checkpoint**: One command produces a replayable, redacted completion report whose only new authorization is later live Gate C/D validation.

---

## Phase 6: Isolation, Failure Matrix, and Handoff

**Purpose**: Prove the production trust boundaries and close the Milestone 6 authorization honestly.

- [x] T070 [P] Add digest-pinned fixture-agent and clean-solver images in `containers/fixture-agent/` and `containers/clean-solver/`
- [x] T071 [P] Add container image content, mount, user, capability, credential, oracle, source, package, and network-isolation tests in `tests/harness/container-isolation.test.ts`
- [x] T072 Add intent/effect/completion failure injection across build, event, Git admission, publication, freeze, submission, solver, grading, replay, and promotion in `tests/harness/failure-injection.test.ts`
- [x] T073 Add complete harness files and generated artifacts to formatting, linting, typecheck, contract comparison, and public-boundary verification in `package.json` and `tests/contract/foundation-boundaries.test.ts`
- [x] T074 Validate every command and claim in `specs/005-end-to-end-harness/quickstart.md`
- [x] T075 Run two fresh `pnpm harness:offline` attempts and prove the first remains byte-identical and independently replayable
- [x] T076 Run `pnpm verify`, `pnpm verify:clean-snapshot`, and `git diff --check`
- [ ] T077 Complete the exact Milestone 6 report and update implementation status in `docs/roadmap.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- Setup precedes all implementation.
- Foundational contracts and attempt identity block all user stories.
- US1 produces the only bundle US2 may consume.
- US2 produces the only sealed run US3 may grade.
- US3 produces the only report Phase 6 may promote.
- Phase 6 authorizes later live model evaluation only after every required predicate passes.

### User Story Dependencies

- **US1** is independently testable as a deterministic production instance pipeline.
- **US2** depends on US1 but is independently testable with a sealed run and fixture outcomes.
- **US3** depends on US2 but is independently testable from sealed artifacts without running workers again.

### Parallel Opportunities

- T003 and T004 can run in parallel.
- T008 through T010 and T012 can run in parallel after schema definitions.
- T015 through T019 are independent failing-test tasks.
- T020 and T021 use separate instance surfaces.
- T028 through T037 are independent failing-test groups.
- T038 through T040, T042, and T043 use separate run-control files.
- T054 through T060 are independent failing-test groups.
- T061, T063, and T058 can proceed on separate solver, scoring, and report surfaces.
- T070 and T071 can begin after the runtime mount and bridge contracts stabilize.

## Implementation Strategy

### MVP First

1. Complete setup and cross-runtime contracts.
2. Deliver US1 as a deterministic three-shard instance accepted by runtime preflight.
3. Keep all model-provider paths disabled.

### Incremental Delivery

1. Add lifecycle, event, bridge, Git Gateway, publication, freeze, and private submission behavior.
2. Seal one production-shaped offline run.
3. Add hostile solver execution, grading, replay, and public redaction.
4. Compose the exact offline command and execute two isolated attempts.
5. Authorize Gate C/D only from the passing Milestone 6 report.

## Notes

- Tests must fail before their implementation task is completed.
- Fixture-agent mistakes remain outcomes; trusted code never repairs them.
- `current.json` is never an evidence input.
- No task authorizes an OpenAI or other external model call.
- Optional Spec Kit Git hooks are not part of task completion unless the user requests commits.
