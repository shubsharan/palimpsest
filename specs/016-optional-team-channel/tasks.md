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

## Dependencies And Execution Order

- T001-T006 establish the immutable mode contract.
- User Story 1 depends on T003-T006.
- User Story 2 depends on User Story 1's conditional tool boundary.
- User Story 3 depends on accepted message delivery from User Story 1.
- T018-T019 require all user stories.

## Parallel Opportunities

- T003 and T004 cover independent configuration and artifact codecs.
- T007 and T008 cover the room and tool/activity contracts in separate files.
- T012 and T013 cover prompts and runtime propagation independently.
- T016 can begin after the User Story 1 trace event shape is fixed.

## Implementation Strategy

Deliver the enabled shared-room slice first, then prove disabled/isolated absence, then complete provenance and documentation. Reuse the existing tool, activity, trace, prompt, manifest, receipt, and protocol boundaries. Add no transport, service, database, private-message topology, automatic injection, moderator, summarizer, or grading path.
