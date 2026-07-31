# Tasks: Configurable Run Controls

**Input**: Design documents from `specs/019-configurable-run-controls/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

## Phase 1: Setup

- [x] T001 Update active feature pointers and researcher-facing scope in `.specify/feature.json`, `AGENTS.md`, and `CLAUDE.md`

## Phase 2: Foundational

- [x] T002 Define nullable token-policy and returned-summary evidence types in `src/config.ts`, `src/model.ts`, and `src/artifacts.ts`
- [x] T003 Replace fixed clock schema literals with safe structural bounds in `experiments/schema.json` and configuration fixtures under `tests/fixtures/config/`

## Phase 3: User Story 1 - Configure Each Puzzle Run

**Goal**: Make schedule and resource controls real manifest inputs.

**Independent Test**: Multiple valid manifests drive different fake-clock and token-policy outcomes without source changes.

- [x] T004 [P] [US1] Add multiple-schedule, invalid-relationship, and nullable-token tests in `src/config.test.ts`
- [x] T005 [P] [US1] Add enabled and disabled token-policy session tests in `src/session.test.ts`
- [x] T006 [P] [US1] Add direct run-control invariant tests in `src/run.test.ts`
- [x] T007 [US1] Implement schedule relationship and nullable authorization validation in `src/config.ts`
- [x] T008 [US1] Thread configurable schedules and nullable token policy through prompts and sessions in `src/prompt.ts`, `src/session.ts`, and `src/run.ts`

## Phase 4: User Story 2 - Freeze One Run Without Freezing Every Run

**Goal**: Preserve exact per-run controls through receipts and durable artifacts.

**Independent Test**: Distinct controls round-trip independently and drift fails before provider work.

- [x] T009 [P] [US2] Add artifact round-trip and invariant tests for distinct controls in `src/artifacts.test.ts`
- [x] T010 [P] [US2] Add receipt, reservation, adjustment, and replacement tests for nullable token authorization in `src/study.test.ts`
- [x] T011 [US2] Update protocol, attempt, receipt, reservation, and phase schemas in `src/artifacts.ts`
- [x] T012 [US2] Update study freezing, authorization, drift, and launch plumbing in `src/study.ts`, `src/configured-run.ts`, `src/experiment.ts`, and helpers

## Phase 5: User Story 3 - Inspect Returned Reasoning Summaries Safely

**Goal**: Preserve a safe exact provider-summary subset independently of run controls.

**Independent Test**: Synthetic responses prove exact capture, empty/unavailable distinction, exclusions, and trace propagation.

- [x] T013 [P] [US3] Add exact extraction and exclusion tests in `src/provider.test.ts`
- [x] T014 [P] [US3] Add returned-summary trace propagation tests in `src/session.test.ts`
- [x] T015 [US3] Implement OpenAI Responses summary extraction in `src/provider.ts`
- [x] T016 [US3] Record returned-summary evidence in `src/session.ts`

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T017 Update the example manifest and public protocol documentation in `experiments/config.yaml`, `README.md`, `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`
- [x] T018 Reconcile affected fixtures and integration expectations across `src/`, `tests/`, and `specs/019-configurable-run-controls/`
- [ ] T019 Run formatting, focused tests, and full provider-free verification from the clean feature implementation

T019 is complete except for one pre-existing local-state assertion: the repository contains an empty `.cursor/` directory that the integration boundary test requires to be absent. All 415 nonfailing TypeScript tests and all 93 Python tests pass.

## Dependencies

- T001 through T003 establish shared contracts.
- T004 through T008 complete User Story 1.
- T009 through T012 depend on the resolved types from User Story 1.
- T013 through T016 are independent of clock implementation after T002.
- T017 through T019 follow all implementation stories.

## Parallel Opportunities

- T004, T005, and T006 target separate test surfaces.
- T009 and T010 target artifact and study behavior separately.
- T013 and T014 target provider extraction and session propagation separately.

## Implementation Strategy

First make manifest controls structurally valid and executable, then freeze them through every durable boundary. Reapply the smallest safe returned-summary subset last. Do not add named presets, a second runner path, migration machinery, or a live provider run.
