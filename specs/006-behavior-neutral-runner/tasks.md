---
description: "Implementation tasks for the behavior-neutral multi-agent puzzle runner"
---

# Tasks: Behavior-Neutral Multi-Agent Puzzle Runner

**Input**: Design documents from `/specs/006-behavior-neutral-runner/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

**Verification**: Tests are mandatory and are written before the corresponding implementation. Verification covers deterministic puzzle mechanics, independent session lifecycle, optional ordinary Git collaboration, aggregate checker disclosure, resource cutoffs, scoring, trace capture, and the absence of a prescribed workflow.

**Organization**: Tasks are grouped by user story so each story has an independent outcome and test boundary.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no incomplete dependency
- **[Story]**: Maps the task to a user story from `spec.md`
- Every task names its intended file paths

## Phase 1: Setup

**Purpose**: Establish the new canonical package and puzzle module without activating the runner.

- [ ] T001 Create `packages/puzzle-runner/package.json`, `packages/puzzle-runner/tsconfig.json`, `packages/puzzle-runner/src/index.ts`, and workspace references in `pnpm-workspace.yaml` and `tsconfig.json`
- [ ] T002 [P] Create `python/src/palimpsest/puzzle/__init__.py` and `python/tests/puzzle/__init__.py`
- [ ] T003 [P] Add canonical `puzzle:build`, `puzzle:run`, `puzzle:evaluate`, and `puzzle:offline` command placeholders to `package.json` and create `tools/puzzle/build.ts`, `tools/puzzle/run.ts`, `tools/puzzle/evaluate.ts`, and `tools/puzzle/offline.ts`
- [ ] T004 Confirm runtime versions, existing generation/revision/scoring reuse, and target-excluded corpus input assumptions in `specs/006-behavior-neutral-runner/quickstart.md`

---

## Phase 2: Foundational

**Purpose**: Define shared records, configuration, observations, and adapter boundaries required by every story.

**Critical**: No user story implementation starts until this phase is complete.

- [ ] T005 Write failing configuration and record-shape tests in `packages/puzzle-runner/tests/config.test.ts` and `python/tests/puzzle/test_model.py`
- [ ] T006 [P] Implement deterministic Python build, stage, checker, score, and overlap data types in `python/src/palimpsest/puzzle/model.py`
- [ ] T007 [P] Implement TypeScript attempt, session, activity, tool, adapter, and evaluation types in `packages/puzzle-runner/src/config.ts` and `packages/puzzle-runner/src/adapters.ts`
- [ ] T008 Implement explicit configuration validation with exactly three agents, six stages, positive limits, and no interaction caps in `packages/puzzle-runner/src/config.ts`
- [ ] T009 Implement append-only monotonic JSONL observation capture with secret redaction in `packages/puzzle-runner/src/observations.ts`
- [ ] T010 Add deterministic fixture and live OpenAI adapter skeletons with cumulative usage reporting in `packages/puzzle-runner/src/adapters.ts`

**Checkpoint**: Shared types and adapter boundaries are independently verified.

---

## Phase 3: User Story 1 - Let A Frontier-Model Team Solve Freely (Priority: P1)

**Goal**: Run exactly three independent persistent sessions with equivalent tools and ordinary shared Git, without roles, rounds, checkpoints, or required collaboration behavior.

**Independent Test**: Script three fixture agents with different working, waiting, Git, no-Git, and voluntary-finish behaviors and verify they reach terminal states without a global barrier or prescribed artifact.

### Verification For User Story 1

- [ ] T011 [P] [US1] Write failing prompt tests that assert peer/Git clarity and reject algorithm, role, turn, checkpoint, required-Git, and required-artifact language in `tests/puzzle/prompt.test.ts`
- [ ] T012 [P] [US1] Write failing ordinary Git tests covering no operations, branches, commits, pushes, fetches, and arbitrary refs without metering or content rejection in `tests/puzzle/git.test.ts`
- [ ] T013 [P] [US1] Write failing lifecycle tests for independent working, waiting, voluntary finish, per-agent token exhaustion, global time exhaustion, and no round barrier in `tests/puzzle/supervisor.test.ts`
- [ ] T014 [P] [US1] Write failing tool-boundary tests for equivalent local command, Git, checker, and wait availability in `tests/puzzle/tools.test.ts`

### Implementation For User Story 1

- [ ] T015 [P] [US1] Implement the concise identity-specific team prompt from `contracts/tools.md` in `packages/puzzle-runner/src/prompt.ts`
- [ ] T016 [P] [US1] Implement ordinary bare-remote setup, per-agent clones, Git activity detection, and frozen repository capture in `packages/puzzle-runner/src/git.ts`
- [ ] T017 [P] [US1] Implement safe local command execution and common agent tool definitions in `packages/puzzle-runner/src/tools.ts`
- [ ] T018 [US1] Implement one persistent tool/model cycle, voluntary final response, waiting, cumulative token cutoff, and terminal-state invariants in `packages/puzzle-runner/src/session.ts`
- [ ] T019 [US1] Implement exactly three concurrently started sessions, independent cancellation, global wall-time shutdown, and workspace freezing in `packages/puzzle-runner/src/supervisor.ts`
- [ ] T020 [US1] Implement the deterministic fixture adapter scenarios and live OpenAI Responses tool cycle in `packages/puzzle-runner/src/adapters.ts`
- [ ] T021 [US1] Wire `puzzle:run` argument parsing, attempt setup, supervision, and final JSON output in `tools/puzzle/run.ts`

**Checkpoint**: User Story 1 works with fixture agents independently of staged re-key behavior and final evaluation.

---

## Phase 4: User Story 2 - Encounter Evidence That Challenges Prior Beliefs (Priority: P2)

**Goal**: Deliver six immutable private stages per agent on one clock, with useful evidence before and after a shared hidden partial re-key.

**Independent Test**: Rebuild a fixed fixture twice and verify identical bytes, a complete revised substitution, only selected mappings changed, six non-empty stages per stream, the same stage-four transition, and waiting-session wakeup without synchronization.

### Verification For User Story 2

- [ ] T022 [P] [US2] Write failing deterministic build and property tests for three streams, six non-empty stages, a learnable pre-transition rule, consequential contradictory post-transition evidence, transition invariants, and immutable earlier bytes in `python/tests/puzzle/test_build.py`
- [ ] T023 [P] [US2] Write failing activity and chronology tests for schedule independence, hidden transition delivery, per-recipient stage visibility, Git activity, cursor semantics, selective waiting-session wakeup, stale-rule persistence, peer communication, and voluntary revision in `tests/puzzle/activity.test.ts`
- [ ] T024 [P] [US2] Write a failing build CLI contract test that proves oracle/private/public path separation and reproducible output in `tests/puzzle/cli.test.ts`

### Implementation For User Story 2

- [ ] T025 [P] [US2] Implement deterministic three-stream segmentation and shared partial re-key construction using existing generation primitives in `python/src/palimpsest/puzzle/build.py`
- [ ] T026 [US2] Implement the host-only Python build CLI and sanitized public result in `python/src/palimpsest/puzzle/build.py`
- [ ] T027 [P] [US2] Implement append-only activity events, cursors, selective wakeup, and fixed monotonic stage scheduling in `packages/puzzle-runner/src/activity.ts`
- [ ] T028 [US2] Implement immutable private stage publication outside Git and connect it to session wakeup in `packages/puzzle-runner/src/supervisor.ts`
- [ ] T029 [US2] Wire `puzzle:build` to the Python builder and validate the emitted build in `tools/puzzle/build.ts`

**Checkpoint**: User Story 2 reproduces the intended evidence and transition independently of agent behavior.

---

## Phase 5: User Story 3 - Check And Review What The Team Produced (Priority: P3)

**Goal**: Let agents receive aggregate feedback on released private evidence, then freeze and reviewer-score arbitrary team code while retaining behavior as observation.

**Independent Test**: Exercise valid, partial, extra, missing, malformed, repeated-check, raw-sharing, successful solver, broken solver, absent output, and no-entrypoint fixtures and verify disclosure, status, score, trace, and non-invalidating overlap behavior.

### Verification For User Story 3

- [ ] T030 [P] [US3] Write failing checker tests for released-only truth, missing/extra tokens, aggregate metrics, repeated calls, execution errors, and zero correction or mismatch disclosure in `python/tests/puzzle/test_checker.py`
- [ ] T031 [P] [US3] Write failing score tests for exact, partial, missing, extra, malformed, and unequal-token reconstructions in `python/tests/puzzle/test_score.py`
- [ ] T032 [P] [US3] Write failing narrow exact/normalized long-span overlap tests and non-blocking behavior assertions in `python/tests/puzzle/test_overlap.py`
- [ ] T033 [P] [US3] Write failing reviewer tests for `scored`, `not-runnable`, `no-output`, and `execution-error`, selection-before-execution, and score preservation in `tests/puzzle/evaluator.test.ts`
- [ ] T034 [P] [US3] Write a failing end-to-end offline test covering build, three sessions, six stages, checker, ordinary Git, freeze, overlap observation, reviewer selection, and score explanation in `tests/puzzle/offline.test.ts`

### Implementation For User Story 3

- [ ] T035 [P] [US3] Implement released-stage aggregate checking without positional disclosure in `python/src/palimpsest/puzzle/checker.py`
- [ ] T036 [P] [US3] Implement tolerant deterministic full reconstruction scoring in `python/src/palimpsest/puzzle/score.py`
- [ ] T037 [P] [US3] Implement conservative exact and normalized long-span observation in `python/src/palimpsest/puzzle/overlap.py`
- [ ] T038 [US3] Connect `check_reconstruction` to host-only released truth and retain aggregate calls in `packages/puzzle-runner/src/tools.ts`
- [ ] T039 [US3] Implement reviewer selection recording, frozen command execution, output handling, four statuses, and Python scoring in `packages/puzzle-runner/src/evaluator.ts`
- [ ] T040 [US3] Wire `puzzle:evaluate` and its reviewer-authored arguments in `tools/puzzle/evaluate.ts`
- [ ] T041 [US3] Wire the fresh offline build-run-evaluate fixture and explanatory result in `tools/puzzle/offline.ts`

**Checkpoint**: All three user stories are independently functional and the full offline path is runnable.

---

## Phase 6: Active-Path Migration And Documentation

**Purpose**: Make the simple runner the unambiguous current product and remove active hardened workflow surfaces.

- [ ] T042 [P] Rewrite `docs/proposal.md` around puzzle purpose, agent experience, experimental posture, evaluation, and limited claims
- [ ] T043 [P] Rewrite `docs/architecture.md` around builder, three persistent sessions, private stage delivery, ordinary Git, aggregate checker, supervisor, evaluator, and raw trace
- [ ] T044 [P] Rewrite `docs/roadmap.md` as functionality milestones without evidence gates, pass ladders, red-team release, or prescribed agent artifacts
- [ ] T045 Update the constitution Sync Impact Report in `.specify/memory/constitution.md` and confirm `AGENTS.md` and `CLAUDE.md` point to `specs/006-behavior-neutral-runner/plan.md`
- [ ] T046 Remove active `harness:*` scripts from `package.json` and delete retired `tools/harness/`, `tests/harness/`, `python/tests/harness/`, and `python/src/palimpsest/replay/harness.py` only after the new offline path passes
- [ ] T047 Update the root description, command documentation, formatter/linter inputs, and any current-state references to identify the behavior-neutral runner as canonical

---

## Phase 7: Verification And Completion Audit

**Purpose**: Produce fresh evidence for every feature claim and leave a clean reviewable branch.

- [ ] T048 Run focused Python puzzle tests and TypeScript puzzle-runner tests from `specs/006-behavior-neutral-runner/quickstart.md`
- [ ] T049 Run two fresh offline fixtures from the same fixed inputs and compare puzzle bytes, transition selection, checker aggregates, terminal states, and final scores
- [ ] T050 Run fixture scenarios for no Git, raw relay, repeated checking, independent work, centralized work, stale-rule persistence followed by peer-assisted revision, token exhaustion, time exhaustion, broken solver, and no runnable output and confirm none becomes an invalid attempt
- [ ] T051 Run `pnpm verify`, `git diff --check`, and a clean status audit; distinguish any unavailable external live-model check from offline completion evidence
- [ ] T052 Audit FR-001 through FR-020 and SC-001 through SC-011 against code, tests, docs, and fresh artifacts; resolve every gap before completion
- [ ] T053 Mark completed tasks in `specs/006-behavior-neutral-runner/tasks.md` and create final logical Git checkpoint(s) without including generated attempt artifacts

---

## Dependencies And Execution Order

### Phase Dependencies

- **Setup**: Starts immediately.
- **Foundational**: Depends on Setup and blocks all user stories.
- **User Story 1**: Depends on Foundational.
- **User Story 2**: Depends on Foundational; integrates with the User Story 1 supervisor but has an independent build/activity test boundary.
- **User Story 3**: Depends on Foundational; final offline integration depends on User Stories 1 and 2.
- **Migration**: Documentation may begin after the analyzed design; destructive active-path removal waits for the new offline path.
- **Verification**: Depends on all intended implementation and migration tasks.

### User Story Dependencies

- **User Story 1** supplies sessions, tools, Git, and supervision.
- **User Story 2** supplies the staged puzzle and wake-producing evidence activity.
- **User Story 3** supplies checker, overlap observation, reviewer execution, and final scoring.
- Python build/check/score work and TypeScript session/Git work can proceed in parallel after Foundational because they touch different files.

### Test-First Order

1. Write the verification task for one bounded component.
2. Run it and confirm failure for the missing behavior.
3. Implement only the behavior required by the contract.
4. Run the focused test before integrating the next component.
5. Commit after each logical story or migration checkpoint.

### Parallel Opportunities

- T002 and T003 can run after T001 boundaries are understood.
- T006 and T007 can run in parallel.
- T011 through T014 can run in parallel.
- T015 through T017 can run in parallel.
- T022 through T024 can run in parallel.
- T025 and T027 can run in parallel.
- T030 through T034 can run in parallel.
- T035 through T037 can run in parallel.
- T042 through T044 can run in parallel.

## Implementation Strategy

### Minimum Runnable Increment

1. Complete Setup and Foundational.
2. Complete User Story 1 with fixture sessions and ordinary Git.
3. Validate that no interaction, Git, role, or artifact sequence is required.
4. Add staged evidence, checking, and evaluation without changing that lifecycle.

### Team Workstreams

1. Python workstream: deterministic build, checker, tolerant score, overlap observer, and their tests.
2. Runtime workstream: prompt, adapters, session supervisor, activity, local tools, ordinary Git, and their tests.
3. Operator workstream: CLIs, reviewer evaluation, offline integration, current-state docs, and migration.
4. Integration owner: shared configuration, package wiring, cross-workstream tests, active-path removal, and final requirements audit.

## Notes

- `[P]` marks non-overlapping work only; agents coordinate shared type changes before editing.
- Model-created files and behaviors are never promoted into validity requirements.
- Standard host safety and secret isolation remain implementation constraints, not puzzle safeguards or benchmark claims.
- Generated attempt artifacts remain untracked.
