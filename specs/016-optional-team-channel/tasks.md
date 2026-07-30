# Tasks: Optional Team Channel

**Input**: Design documents from `specs/016-optional-team-channel/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/team-channel.md`, `quickstart.md`

## Phase 1: Setup

- [x] T001 Bind Feature 016 as the current plan in `.specify/feature.json` and `AGENTS.md`
- [x] T002 Add the explicit enabled next-run manifest example and schema-version contract in `experiments/config.yaml` and `experiments/schema.json`

## Phase 2: Foundational Contracts

- [x] T003 [P] Add failing mode decoding, required-field, invalid-value, and digest tests in `src/config.test.ts`
- [x] T004 [P] Add failing protocol-version and required team-channel identity tests in `src/artifacts.test.ts`
- [x] T005 Implement strict schema-v3 team-channel configuration and immutable resolution in `src/config.ts`
- [x] T006 Implement protocol-v2 team-channel identity decoding and encoding in `src/artifacts.ts` and `src/condition.ts`

**Checkpoint**: Every run declares and durably binds one unambiguous channel mode.

## Phase 3: User Story 1 - Enable Direct Team Discussion (Priority: P1)

**Goal**: Enabled shared-condition agents can post, read, and wake peers through one public room.

**Independent Test**: Provider-free shared agents exchange ordered messages and a waiting peer resumes.

- [x] T007 [P] [US1] Add failing ordering, validation, paging, and activity-delivery tests, now consolidated in `src/attempt-runtime.test.ts`
- [x] T008 [P] [US1] Add failing enabled tool-definition, post, read, and wake-summary tests in `src/tools.test.ts` and `src/activity.test.ts`
- [x] T009 [US1] Implement the attempt-local public room and bounded message pages in `src/team-channel.ts`
- [x] T010 [US1] Add team-message activity and conditionally exposed post/read tools in `src/activity.ts` and `src/tools.ts`
- [x] T011 [US1] Construct the eligible room, trace accepted posts, and bind it to agent sessions in `src/run.ts`

**Checkpoint**: Direct discussion works without changing Git, checker, or solver evaluation.

## Phase 4: User Story 2 - Preserve Git-Only Tests (Priority: P2)

**Goal**: Disabled and isolated attempts expose no direct channel and preserve existing behavior.

**Independent Test**: Prompt/tool snapshots prove exact Git-only behavior when disabled and peer non-observability when isolated.

- [x] T012 [P] [US2] Add enabled-shared, disabled-shared, and isolated prompt/tool parity tests in `src/prompt.test.ts` and `src/tools.test.ts`
- [x] T013 [P] [US2] Add standalone, study, and offline option-propagation tests in `src/run.test.ts`, `src/study.test.ts`, `src/experiment.test.ts`, and `tests/puzzle/offline.test.ts`
- [x] T014 [US2] Bind mode-aware prompts and receipt snapshots in `src/prompt.ts` and `src/study.ts`
- [x] T015 [US2] Propagate the resolved mode through `src/configured-run.ts`, `src/experiment.ts`, `src/offline.ts`, `src/fixture.ts`, and test helpers

**Checkpoint**: Changing only the declared mode selects direct discussion or the prior Git-only environment.

## Phase 5: User Story 3 - Retain the Complete Discussion Record (Priority: P3)

**Goal**: Accepted posts are reconstructable once from the durable attempt trace.

**Independent Test**: Interleaved provider-free posts freeze with complete author, order, content, timing, reads, and failures.

- [x] T016 [P] [US3] Add accepted-post trace and isolated non-observability integration assertions in `src/run.test.ts` and `tests/puzzle/offline.test.ts`
- [x] T017 [US3] Include channel mode and complete accepted-message events in protocol/trace validation paths in `src/run.ts`, `src/artifacts.ts`, and `src/study.ts`

**Checkpoint**: The trace explains exactly what was communicated without a second transcript authority.

## Phase 6: Documentation And Verification

- [x] T018 Update `README.md`, `docs/proposal.md`, `docs/architecture.md`, `docs/roadmap.md`, and Feature 016 contracts for the optional channel
- [x] T019 Run focused tests, `pnpm verify`, `git diff --check`, commit the feature branch, and run clean `pnpm preflight`

## Phase 7: User Story 4 - Grade the Published Main Snapshot (Priority: P1)

**Goal**: Checker feedback and final evaluation execute one exact exported `refs/heads/main` commit without unpublished or non-main state.

**Independent Test**: Repoint symbolic `HEAD`, publish alternate branch content, retain workspace-only files, and probe forbidden paths; checking and evaluation still execute and record only the captured main snapshot.

- [x] T020 [P] [US4] Add snapshot resolution, exact-main capture, Git-free materialization, and invalid-main tests in `src/published-solver.test.ts`
- [x] T021 [P] [US4] Add solver mount isolation and contained-output tests in `tests/puzzle/sandbox.integration.test.ts`
- [x] T022 [US4] Implement exact-main snapshot materialization and shared solver execution in `src/published-solver.ts`
- [x] T023 [US4] Replace evaluation Git/workspace mounts with read-only submission, ciphertext, and writable output mounts in `src/sandbox/contracts.ts`, `src/sandbox/docker.ts`, and `src/sandbox/container.ts`
- [x] T024 [US4] Route released-stage checking through the shared runner outside agent leases in `src/tools.ts`, `src/run.ts`, and `src/checker.ts`
- [x] T025 [US4] Route final scoring through the shared runner and persist workspace/repository/ref/commit provenance in `src/evaluate.ts` and `src/artifacts.ts`
- [x] T026 [P] [US4] Add checker and final-evaluation adversarial regression probes in `src/tools.test.ts`, `src/evaluate.test.ts`, and `tests/puzzle/attempt-durability.test.ts`
- [x] T027 [US4] Rename the frozen boundary to `selected-workspace-main-snapshot-v1` in `experiments/config.yaml`, `experiments/schema.json`, `src/config.ts`, and dependent tests

## Phase 8: Remediation Documentation And Verification

- [x] T028 Update Feature 016 design artifacts and grading-boundary documentation in `specs/016-optional-team-channel/`, `README.md`, `docs/proposal.md`, and `docs/architecture.md`
- [x] T029 Run focused tests, `pnpm verify`, and `git diff --check`
- [ ] T030 After committing the implementation, run clean receipt-bound `pnpm preflight`

## Phase 9: Immutable Published-Solver Transaction

- [x] T031 [P] Add adversarial capture, released-stage geometry, infrastructure propagation, and shared-provenance tests in `src/published-solver.test.ts`, `src/tools.test.ts`, `src/evaluate.test.ts`, `src/run.test.ts`, and `tests/puzzle/attempt-durability.test.ts`
- [x] T032 Replace the public resolve/materialize pair with one deadline-bound internal capture transaction in `src/published-solver.ts` and bounded host Git execution in `src/git.ts`
- [x] T033 Replace evidence rescanning with ordered `ReleasedStage` records and canonical released-input assembly in `src/run.ts`, `src/tools.ts`, and `python/palimpsest/evaluation/checker.py`
- [x] T034 Route checker and evaluation through the captured snapshot and preserve typed submission versus infrastructure outcomes in `src/tools.ts` and `src/evaluate.ts`
- [x] T035 Update Feature 016 contracts and design artifacts for fetch-and-materialize capture before identity publication
- [x] T036 Run focused TypeScript tests, provider-free suites, Python tests, `pnpm verify`, and `git diff --check`

## Phase 10: Single-Owner Runtime And Complete Solver Transaction

- [x] T037 [P] Add adversarial release-versus-check, post-versus-close, trusted-checker failure, and cleanup-before-publication tests in `src/attempt-runtime.test.ts`, `src/tools.test.ts`, `src/published-solver.test.ts`, and `src/evaluate.test.ts`
- [x] T038 Replace split team-message, released-stage, activity, Git-change, and shutdown mutation with one serialized `AttemptRuntime` owner in `src/attempt-runtime.ts`, `src/team-channel.ts`, `src/git.ts`, and `src/run.ts`
- [x] T039 Make every agent tool consume an immutable attempt handle and capture released stages before asynchronous solver work in `src/tools.ts` and `src/run.ts`
- [x] T040 Replace the public snapshot callback with one complete `runPublishedSolver` operation that captures, executes, evaluates, cleans, and only then returns a typed outcome in `src/published-solver.ts`
- [x] T041 Publish checker and evaluation results only after `runPublishedSolver` succeeds, and classify rejected trusted evaluation hooks as infrastructure failures in `src/tools.ts` and `src/evaluate.ts`
- [x] T042 Update Feature 016 plan, research, data model, contracts, and quickstart for single-owner attempt state and cleanup-before-publication
- [x] T043 Run focused TypeScript tests, provider-free suites, Python tests, `pnpm verify`, and `git diff --check`

Verification note (2026-07-30): all 33 Vitest files and 406 TypeScript tests, all 93 Python tests, the real-container output-quota probe, formatting, lint, type-check, and `git diff --check` pass.

## Phase 11: Atomic Publication Boundaries

- [x] T044 [P] Add adversarial trace-backlog stage-release and solver-output extraction tests in `src/attempt-runtime.test.ts`, `src/sandbox/docker.test.ts`, and `src/sandbox/container.test.ts`
- [x] T045 Replace trace-I/O locking with synchronous live commits plus one ordered durable trace projection, and atomically rename privately prepared stages in `src/attempt-runtime.ts` and `src/run.ts`
- [x] T046 Replace the solver's writable host output bind with bounded container tmpfs and validated atomic host extraction in `src/sandbox/contracts.ts`, `src/sandbox/docker.ts`, `src/sandbox/container.ts`, and `src/published-solver.ts`
- [x] T047 Update Feature 016 design artifacts and repository documentation for live-authority and bounded-publication invariants
- [x] T048 Run focused TypeScript tests, provider-free suites, Python tests, `pnpm verify`, and `git diff --check`

## Dependencies And Execution Order

- T001-T006 establish the immutable mode contract.
- User Story 1 depends on T003-T006.
- User Story 2 depends on User Story 1's conditional tool boundary.
- User Story 3 depends on accepted message delivery from User Story 1.
- T018-T019 require all user stories.
- T020-T021 specify the User Story 4 boundary before T022-T025 implementation.
- T024 and T025 depend on the shared runner and sandbox contract from T022-T023.
- T026-T027 complete User Story 4 before T028-T030 verification.
- T031 specifies the immutable transaction boundary before T032-T034 implementation.
- T033 and T034 depend on the captured snapshot interface from T032.
- T035-T036 complete the immutable transaction slice; T030 still requires a committed clean tree.
- T037 specifies the ownership and lifecycle invariants before T038-T041.
- T038-T039 establish immutable attempt views before T040-T041 consume them.
- T042 documents the implemented boundaries; T043 verifies the complete remediation.
- T044 specifies the publication boundaries before T045-T046 implementation.
- T045 and T046 are independent root-boundary changes; T047-T048 document and verify them together.

## Parallel Opportunities

- T003 and T004 cover independent configuration and artifact codecs.
- T007 and T008 cover the room and tool/activity contracts in separate files.
- T012 and T013 cover prompts and runtime propagation independently.
- T016 can begin after the User Story 1 trace event shape is fixed.
- T020 and T021 cover independent snapshot and real-sandbox contracts.
- T026 can split checker, evaluator, and durability probes across separate test files.
- T031 can split capture, checker, evaluator, and durability probes across independent test files.
- T037 can split attempt-runtime and published-solver invariant tests.
- T045 and T046 can proceed independently after T044.

## Implementation Strategy

Deliver the enabled shared-room slice first, then prove disabled/isolated absence, then complete provenance and documentation. Reuse the existing tool, activity, trace, prompt, manifest, receipt, and protocol boundaries. Add no transport, service, database, private-message topology, automatic injection, moderator, summarizer, or grading path.

The remediation slice first fixes the shared published-solver contract with adversarial tests, then routes checker and evaluator through it, then updates frozen identity and documentation. Reuse the existing short-lived Docker sandbox and Python scoring hooks; add no grader service or permanent duplicate submission store.

The immutable transaction slice captures literal `refs/heads/main` into one private local ref, materializes that pinned object before publishing its identity, and supplies it only inside a callback. Released input is assembled from ordered host-owned stage records, and only agent submission failures become normal checker or evaluation results.

The single-owner remediation replaces that callback and all live attempt-state getters. One small serialized attempt runtime commits treatment-state trace events before synchronously updating private projections, returns copied released-stage snapshots, and closes only after queued publications and Git monitoring quiesce. One complete published-solver operation owns capture through cleanup, returns only after cleanup succeeds, and leaves durable result publication to its caller.

The atomic-publication slice makes the runtime's synchronous in-memory commit the live authority and serializes only its durable trace projection, so treatment traffic cannot delay scheduled evidence visibility. Stage bytes are prepared outside agent mounts and atomically renamed during that commit; a trace failure poisons the whole attempt. Solver bytes remain in bounded container tmpfs until the stopped container yields one declared regular file to hidden host staging, where validation precedes atomic durable publication.
