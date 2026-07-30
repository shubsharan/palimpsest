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

- [x] T007 [P] [US1] Add failing ordering, validation, paging, and activity-delivery tests in `src/team-channel.test.ts`
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

## Dependencies And Execution Order

- T001-T006 establish the immutable mode contract.
- User Story 1 depends on T003-T006.
- User Story 2 depends on User Story 1's conditional tool boundary.
- User Story 3 depends on accepted message delivery from User Story 1.
- T018-T019 require all user stories.
- T020-T021 specify the User Story 4 boundary before T022-T025 implementation.
- T024 and T025 depend on the shared runner and sandbox contract from T022-T023.
- T026-T027 complete User Story 4 before T028-T030 verification.

## Parallel Opportunities

- T003 and T004 cover independent configuration and artifact codecs.
- T007 and T008 cover the room and tool/activity contracts in separate files.
- T012 and T013 cover prompts and runtime propagation independently.
- T016 can begin after the User Story 1 trace event shape is fixed.
- T020 and T021 cover independent snapshot and real-sandbox contracts.
- T026 can split checker, evaluator, and durability probes across separate test files.

## Implementation Strategy

Deliver the enabled shared-room slice first, then prove disabled/isolated absence, then complete provenance and documentation. Reuse the existing tool, activity, trace, prompt, manifest, receipt, and protocol boundaries. Add no transport, service, database, private-message topology, automatic injection, moderator, summarizer, or grading path.

The remediation slice first fixes the shared published-solver contract with adversarial tests, then routes checker and evaluator through it, then updates frozen identity and documentation. Reuse the existing short-lived Docker sandbox and Python scoring hooks; add no grader service or permanent duplicate submission store.
