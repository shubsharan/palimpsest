# Tasks: Four Team Conditions

**Input**: Design documents from `specs/014-four-team-conditions/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/condition-runtime.md`

**Verification**: Provider-free tests must prove exact condition derivation, condition-selected variants, explicit release offsets and cutoff, shared peer visibility, isolated Git/activity non-observability, own-Git usability, prompt parity and neutrality, native topology freezing, strict attempt records, independent overlap scans, and selected-origin evaluation. Feature 014 does not run live providers or authorize paid research.

## Phase 1: Contract Setup

**Purpose**: Freeze the condition and attempt contracts before runtime changes.

- [x] T001 [P] Add strict four-condition mapping, invalid-token, schedule-constant, and protocol-digest tests in `src/condition.test.ts`
- [x] T002 Implement canonical condition decoding, exact release offsets/cutoff, and deterministic secret-free protocol hashing in `src/condition.ts`
- [x] T003 [P] Add attempt schema-version-3 round-trip, condition/variant mismatch, schedule drift, topology drift, and protocol-digest rejection tests in `src/artifacts.test.ts`
- [x] T004 Extend attempt artifacts and test helpers with block, condition, derived treatment, selected variant, fixed schedule, protocol snapshot/digest, and frozen Git inventory in `src/artifacts.ts` and `src/test-helpers.ts`

**Checkpoint**: One strict condition and durable-attempt contract exists before execution changes.

## Phase 2: Foundational Runtime Primitives

**Purpose**: Establish exact timing, condition-neutral tools, and a topology-aware Git environment.

- [x] T005 [P] Add exact six-offset, exact-boundary, cancellation, and monotonic-clock tests in `src/reveal.test.ts`
- [x] T006 Replace interval scheduling with an explicit offset vector in `src/reveal.ts`
- [x] T007 [P] Add activity visibility tests proving private stage/Git streams have contiguous owner-visible sequences and no hidden-peer gaps in `src/activity.test.ts`
- [x] T008 Make activity visibility explicit and condition-neutral in `src/activity.ts` and `src/tools.ts`
- [x] T009 [P] Add shared/isolated repository creation, own-origin usability, peer ref visibility, monitor ownership, and complete freeze tests in `src/git.test.ts`
- [x] T010 Generalize Git creation, monitoring, workspace assignment, and freezing to shared or isolated repository inventories in `src/git.ts`
- [x] T011 [P] Add sandbox mount tests proving exactly one assigned origin appears at `/git/origin.git` with no peer origins in `src/sandbox/docker.test.ts`
- [x] T012 Rename the sandbox Git input to one assigned origin while preserving all other mounts, tools, and limits in `src/sandbox/contracts.ts`, `src/sandbox/docker.ts`, and `src/test-helpers.ts`

**Checkpoint**: Fixed schedules and both native Git topologies work without model sessions.

## Phase 3: User Story 1 - Select One Canonical Condition (Priority: P1)

**Goal**: Run one strict condition and select its derived paired-build variant.

**Independent Test**: Resolve and execute all four identifiers with fixture inputs, reject every non-canonical identifier before side effects, and confirm each selected build ID matches the declared variant.

### Verification

- [x] T013 [P] [US1] Add condition-selected build, attempt identity, mismatch, and provider-preflight tests in `src/run.test.ts`
- [x] T014 [P] [US1] Add strict `--condition` CLI/config tests and removal tests for configurable timing in `src/config.test.ts`, `src/experiment.test.ts`, and `tests/puzzle/cli.test.ts`

### Implementation

- [x] T015 [US1] Thread the canonical condition through `AttemptConfig`, `RunPuzzleOptions`, validation, attempt IDs, and condition-derived variant selection in `src/run.ts`
- [x] T016 [US1] Remove schema-v1 timing drift and require one condition at the run/experiment boundary in `experiments/schema.json`, `experiments/config.yaml`, `src/config.ts`, `src/configured-run.ts`, `src/experiment.ts`, and `src/cli.ts`

**Checkpoint**: Every canonical condition selects the correct immutable puzzle variant through the operator path.

## Phase 4: User Story 2 - Preserve Or Remove Peer Communication (Priority: P2)

**Goal**: Expose peer Git only in shared conditions while keeping private Git usable in isolated conditions.

**Independent Test**: A shared push is fetchable by peers and wakes them; an isolated push changes and wakes only its owner; every repository/workspace freezes without merge.

### Verification

- [x] T017 [P] [US2] Add run-coordinator tests for three private activity buses, shared wake visibility, isolated non-observability, voluntary no-Git completion, lease origin assignment, and native freeze in `src/run.test.ts`
- [x] T018 [P] [US2] Add independent multi-repository collection/aggregation and agent-prefixed path tests in `src/overlap.test.ts`
- [x] T019 [P] [US2] Add selected-workspace/assigned-origin evaluation tests for both topologies in `src/evaluate.test.ts`

### Implementation

- [x] T020 [US2] Create per-agent activity streams, shared or owner-scoped monitors, assigned sandbox origins, and complete frozen topology publication in `src/run.ts`
- [x] T021 [US2] Scan every frozen repository independently, aggregate counters once, preserve agent provenance, and select the condition variant in `src/overlap.ts`
- [x] T022 [US2] Mount only the explicitly selected workspace's assigned frozen repository and select the condition variant in `src/evaluate.ts`

**Checkpoint**: Communication availability is the only Git visibility difference and isolated work is never merged.

## Phase 5: User Story 3 - Hold The Puzzle Experience Constant (Priority: P3)

**Goal**: Make prompts, schedules, traces, and durable records demonstrate treatment parity.

**Independent Test**: Compare all four prompts and fake-clock traces; only the channel paragraph differs by communication mode, releases occur at all exact offsets, cutoff occurs at 60 minutes, and complete attempts decode.

### Verification

- [x] T023 [P] [US3] Replace prompt snapshots with all-condition parity, exact schedule/limit/tool/evaluation disclosure, and forbidden-prescription assertions in `src/prompt.test.ts`
- [x] T024 [P] [US3] Add trace/attempt assertions for condition, derived treatment, protocol snapshot/digest, exact stage timestamps, sessions, usage, termination, sandbox, and frozen topology in `src/run.test.ts`
- [x] T025 [P] [US3] Add four-condition provider-free build-run-freeze-overlap-evaluate acceptance in `tests/puzzle/offline.test.ts`

### Implementation

- [x] T026 [US3] Replace the agent prompt with invariant identity/objective/schedule/limits/tools/evaluation text plus one communication paragraph in `src/prompt.ts`
- [x] T027 [US3] Publish exact schedule, prompt snapshot, protocol digest, condition, treatment, and topology in attempt traces and schema-version-3 summaries in `src/run.ts`
- [x] T028 [US3] Thread strict condition selection through provider-free offline execution and keep explicit manual evaluation in `src/offline.ts`

**Checkpoint**: All four conditions preserve identical non-treatment inputs and complete auditable records.

## Phase 6: Documentation And Verification

- [x] T029 [P] Update `README.md`, `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md` to mark the four-condition runtime implemented and the frozen protocol still planned
- [x] T030 [P] Validate the operator examples and attempt inspection in `specs/014-four-team-conditions/quickstart.md`
- [x] T031 Run focused condition/runtime suites, format, `pnpm verify`, and `git diff --check`
- [x] T032 Mark every completed Feature 014 task, re-run Spec Kit analysis, and commit the verified branch before Feature 015

## Phase 7: Published Solver Protocol Amendment

- [x] T033 Seed every shared and isolated origin with one deterministic neutral `solver.py` commit in `src/git.ts`
- [x] T034 Replace caller-selected reconstruction checking with exact `origin/main:solver.py` checkout, execution, commit reporting, and aggregate scoring in `src/tools.ts`
- [x] T035 State the word-substitution cipher, shared team submission, Git collaboration incentive, canonical grading boundary, and persistence expectation concisely in `src/prompt.ts`
- [x] T036 Fix final evaluation to the selected frozen origin's `python3 solver.py` interface in `src/evaluate.ts` and `src/offline.ts`
- [x] T037 Cover identical scaffold commits, published-main-only checking, prompt parity, canonical evaluation, and fixture behavior in TypeScript tests
- [x] T038 Amend Constitution 6.0.0, active specifications, contracts, templates, and operator documentation for the published solver boundary

## Dependencies And Parallel Work

- T001-T004 freeze the condition and attempt contracts.
- T005-T012 establish schedule, activity, Git, and sandbox primitives.
- T013-T016 deliver canonical selection and can be tested before isolated execution.
- T017-T022 deliver communication visibility and topology-aware observation/evaluation.
- T023-T028 prove parity and complete the durable runtime.
- T029-T032 require all user stories.
- T033-T038 form the later published-solver protocol amendment and require the implemented native Git topology.
- T001, T003, T005, T007, T009, and T011 touch independent test surfaces and can start in parallel.
- Within each story, verification tasks precede implementation.

## Implementation Strategy

Keep one runtime with data-driven condition selection. Reuse sessions, providers, checker, sandbox, trace, freeze, overlap, and manual evaluation. Generalize only the Git value object and schedule shape; delete obsolete timing and shared-only assumptions instead of wrapping them. Add no service, permissions layer, reviewer automation, retry logic, merge step, or compatibility aliases.
