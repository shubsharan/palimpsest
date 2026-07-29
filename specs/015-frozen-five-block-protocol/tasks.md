# Tasks: Frozen Five-Block Protocol

**Input**: Design documents from `specs/015-frozen-five-block-protocol/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/study-protocol.md`, `quickstart.md`

**Verification**: Tests are mandatory because this feature freezes a findings-bearing study protocol. All acceptance remains provider-free. The final clean receipt-bound preflight verifies the exact committed source and rebuilt sandbox without opening a provider session.

**Organization**: Tasks are grouped by user story and kept within the existing local CLI/runtime boundaries.

## Phase 1: Setup

**Purpose**: Freeze the human-readable protocol inputs before runtime work.

- [ ] T001 Create the versioned non-aggregating behavior review rubric in `experiments/behavior-rubric.md`
- [ ] T002 Update the strict schema-version-2 example manifest and remove the obsolete `runs` shape in `experiments/schema.json` and `experiments/config.yaml`
- [ ] T003 [P] Add schema-version-2 valid, drift, secret, order, and ceiling fixtures in `tests/fixtures/config/`

---

## Phase 2: Foundational Contracts

**Purpose**: Establish strict manifest and artifact types used by every story.

- [ ] T004 Add failing strict manifest-decoding, exact matrix, rubric-digest, and authorized-ceiling tests in `src/config.test.ts`
- [ ] T005 Implement schema-version-2 manifest decoding, credential-free resolution, exact cell expansion, and manifest digests while deleting schema-version-1 run selection in `src/config.ts` and `src/configured-run.ts`
- [ ] T006 Add failing schema-version-4 attempt, design-receipt, phase-summary, launch-reservation, and lineage codec tests in `src/artifacts.test.ts`
- [ ] T007 Implement strict schema-version-4 attempts and schema-version-1 design/phase artifacts, removing `runName` and `repetition`, in `src/artifacts.ts`
- [ ] T008 [P] Update artifact JSON schema fixtures and direct decoder callers for schema version 4 in `src/artifacts.test.ts` and `tests/fixtures/`

**Checkpoint**: The manifest and durable records reject compatibility inputs and round-trip without credentials.

---

## Phase 3: User Story 1 - Freeze The Study Design (Priority: P1)

**Goal**: Prepare all five builds and publish one immutable receipt before any session can open.

**Independent Test**: Resolve the manifest, build five deterministic paired blocks, publish `design.json`, and accept only the two declared budget adjustments within immutable totals.

### Verification

- [ ] T009 [P] [US1] Add failing prompt-template parity and receipt snapshot tests in `src/prompt.test.ts`
- [ ] T010 [P] [US1] Add failing five-build preparation, exclusive receipt publication, build-drift, immutable-drift, and adjustment tests in `src/study.test.ts`
- [ ] T011 [P] [US1] Add failing CLI contract tests for `puzzle:build --block` and calibration receipt timing in `tests/puzzle/cli.test.ts`

### Implementation

- [ ] T012 [US1] Expose token-placeholder prompt templates while preserving Feature 014 concrete prompt bytes in `src/prompt.ts`
- [ ] T013 [US1] Implement design preparation, raw build/rubric/prompt binding, deterministic digests, exclusive `design.json` publication, and validation adjustment checks in `src/study.ts`
- [ ] T014 [US1] Wire block selection and study-root receipt preparation through `src/build.ts` and `src/experiment.ts`
- [ ] T015 [US1] Verify User Story 1 with focused tests and record its exact commands in `specs/015-frozen-five-block-protocol/quickstart.md`

**Checkpoint**: A provider-free calibration setup leaves one immutable receipt binding all five actual builds.

---

## Phase 4: User Story 2 - Execute Calibration And Validation (Priority: P2)

**Goal**: Execute the exact four-cell and sixteen-cell matrices sequentially with durable resumable phase state.

**Independent Test**: Fixture adapters and fake clocks run all twenty primary cells in order, never overlap attempts, retain three concurrent sessions inside each cell, and make zero provider requests.

### Verification

- [ ] T016 [P] [US2] Add failing phase-state, launch-reservation, resume, sequential-attempt, accounting, and complete-matrix tests in `src/study.test.ts`
- [ ] T017 [P] [US2] Add failing attempt study-provenance and standalone compatibility tests in `src/run.test.ts` and `src/artifacts.test.ts`
- [ ] T018 [P] [US2] Add failing provider-preflight ordering and experiment CLI tests in `src/experiment.test.ts` and `tests/puzzle/cli.test.ts`
- [ ] T019 [P] [US2] Add the provider-free five-build/twenty-cell acceptance fixture with fake clocks and fixture adapters in `tests/puzzle/offline.test.ts`

### Implementation

- [ ] T020 [US2] Implement strict phase initialization, atomic launch reservation, durable indexing, resume, and authorization accounting in `src/study.ts`
- [ ] T021 [US2] Extend one-attempt execution with standalone/calibration/validation provenance and frozen session-infrastructure classification in `src/run.ts`
- [ ] T022 [US2] Replace run-name/repetition expansion with `--phase calibration|validation`, ensure preflight precedes provider setup, and keep `puzzle:run --condition` single-attempt in `src/experiment.ts` and `src/offline.ts`
- [ ] T023 [US2] Update CLI parsing and package command contracts for phase and study-root selection in `src/cli.ts`, `package.json`, and `tests/puzzle/cli.test.ts`
- [ ] T024 [US2] Verify User Story 2 with the complete provider-free twenty-cell acceptance and focused runtime suites in `tests/puzzle/experiment.test.ts` and `src/study.test.ts`

**Checkpoint**: Calibration and validation are deterministic local phase expansions; no already indexed cell relaunches.

---

## Phase 5: User Story 3 - Preserve And Replace Infrastructure Failures (Priority: P3)

**Goal**: Stop on a frozen session-infrastructure attempt and append only one explicitly cited eligible replacement.

**Independent Test**: Freeze an eligible source, stop nonzero, append one inherited replacement, resume the next cell, and reject every automatic, duplicate, model-outcome, missing, or non-frozen replacement.

### Verification

- [ ] T025 [P] [US3] Add failing eligible, model-outcome, duplicate, lineage, replacement-failure, and ceiling tests in `src/study.test.ts`
- [ ] T026 [P] [US3] Add failing `--replace <attempt-id>` CLI and non-retry resume tests in `src/experiment.test.ts` and `tests/puzzle/cli.test.ts`

### Implementation

- [ ] T027 [US3] Implement cited replacement validation, inherited treatment/design/budget identity, one-replacement lineage, and appended reservation/accounting in `src/study.ts`
- [ ] T028 [US3] Wire explicit replacement execution and nonzero phase-stop reporting in `src/experiment.ts`
- [ ] T029 [US3] Verify User Story 3 with focused artifact, study, experiment, and CLI suites in `src/artifacts.test.ts`, `src/study.test.ts`, `src/experiment.test.ts`, and `tests/puzzle/cli.test.ts`

**Checkpoint**: Infrastructure replacement is explicit scientific lineage, not a retry mechanism.

---

## Phase 6: Polish And Cross-Cutting Verification

**Purpose**: Remove transitional surfaces, reconcile documentation, and prove the complete feature.

- [ ] T030 [P] Remove schema-version-1 run fixtures and update affected documentation in `README.md`, `docs/proposal.md`, and `docs/architecture.md`
- [ ] T031 [P] Update exact operator commands and artifact layout in `specs/015-frozen-five-block-protocol/quickstart.md`
- [ ] T032 Run formatting, lint, typecheck, complete TypeScript/Python tests, and `git diff --check` with `pnpm verify`
- [ ] T033 Execute `specs/015-frozen-five-block-protocol/quickstart.md` in a fresh temporary study root and inspect receipt, phase, attempt, order, accounting, and replacement artifacts
- [ ] T034 Commit the implementation, run the clean receipt-bound preflight from `package.json` against the exact commit, and retain its source/sandbox receipt without a provider call
- [ ] T035 Re-run `speckit-analyze` and close every remaining spec/plan/task consistency finding

---

## Dependencies And Execution Order

- Setup precedes Foundational Contracts.
- Foundational Contracts block all user stories.
- User Story 1 produces the receipt required by User Story 2.
- User Story 2 produces the phase state and failure artifacts required by User Story 3.
- Polish and cross-cutting verification follows all three stories.

## Parallel Opportunities

- T003 can proceed alongside T001-T002.
- T009-T011 cover separate prompt, study, and CLI files.
- T016-T019 split state, attempt, CLI, and end-to-end acceptance tests.
- T025-T026 split runtime and CLI replacement contracts.
- T030-T031 are documentation-only and can proceed in parallel after behavior stabilizes.

## Implementation Strategy

1. Freeze the strict manifest and artifact codecs.
2. Deliver receipt preparation as the independently testable P1 slice.
3. Add the sequential twenty-cell phase coordinator without changing one-attempt puzzle behavior.
4. Add the narrow explicit replacement path.
5. Remove transitional run surfaces and verify the exact committed state.

No task adds a service, database, account, generic retry engine, automated rubric application, result selector, or aggregation layer.
