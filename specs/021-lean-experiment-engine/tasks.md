# Tasks: Lean Experiment Engine

**Input**: Design documents from `specs/021-lean-experiment-engine/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`

## Phase 1: Setup and Governance

- [x] T001 Amend config-scoped research validation and sync active guidance in `.specify/memory/constitution.md`, `.specify/templates/`, `AGENTS.md`, and `CLAUDE.md`
- [x] T002 Add the four primary command scripts and command dispatch in `package.json` and `src/cli.ts`

## Phase 2: Foundational Contracts

- [x] T003 Define strict unversioned experiment interfaces and secret-safe resolution in `experiments/schema.json`, `src/config.ts`, and `src/config.test.ts`
- [x] T004 [P] Define atomic `RunRecord` validation/publication and canonical-origin invariants in `src/records.ts` and `src/records.test.ts`

## Phase 3: User Story 1 - Prepare Different Puzzle Fixtures (Priority: P1)

**Goal**: Prepare deterministic variable-geometry fixture packages from declarations alone.

**Independent Test**: Build 2-agent/3-stage and 4-agent/8-stage stationary/re-key packages twice and compare bytes and checks.

- [x] T005 [P] [US1] Add definition, variable-geometry, determinism, boundary, and trusted-data-exclusion tests in `python/tests/puzzle/test_block.py`, `python/tests/puzzle/test_build.py`, and `python/tests/puzzle/test_manifest.py`
- [x] T006 [P] [US1] Add build CLI and package-decoder contract tests in `src/build.test.ts` and `tests/puzzle/cli.test.ts`
- [x] T007 [US1] Replace fixed block geometry with strict `FixtureDefinition` decoding in `python/palimpsest/puzzle/block.py`
- [x] T008 [US1] Generalize allocation, variant construction, manipulation checks, and atomic package publication in `python/palimpsest/puzzle/build.py` and `python/palimpsest/puzzle/manifest.py`
- [x] T009 [US1] Decode `FixturePackage`, verify content digests, and expose build commands in `src/fixture-package.ts`, `src/build.ts`, and `src/cli.ts`
- [x] T010 [US1] Express the five historical fixtures plus 2x3 and 4x8 verification fixtures in `experiments/blocks.json` and `tests/fixtures/`

## Phase 4: User Story 2 - Execute Explicit Experiment Configurations (Priority: P1)

**Goal**: Validate and execute manifest runs directly, sequentially across runs and concurrently within each run.

**Independent Test**: A provider-free multi-run manifest varies fixtures, schedules, models, and communication without source edits and stops without retry on failure.

- [x] T011 [P] [US2] Add manifest/package relationship, spend gate, and no-provider-before-validation tests in `src/config.test.ts`, `src/experiment.test.ts`, and `tests/puzzle/cli.test.ts`
- [x] T012 [P] [US2] Add sequential-run, concurrent-session, paired-visibility, and failure-stop tests in `src/experiment.test.ts`, `src/run.test.ts`, `src/attempt-runtime.test.ts`, and `src/git.test.ts`
- [x] T013 [US2] Resolve each declared run against its fixture package and freeze schedule, limits, capabilities, assignments, labels, and digests in `src/config.ts`
- [x] T014 [US2] Generalize prompts, staged releases, Git topology, and sessions to declared agent/stage geometry in `src/prompt.ts`, `src/reveal.ts`, `src/git.ts`, `src/session.ts`, and `src/run.ts`
- [x] T015 [US2] Replace phase planning, reservations, replacements, and resume behavior with manifest-order execution in `src/experiment.ts`
- [x] T016 [US2] Implement exact config/package validation, sandbox probe, provider-free smoke path, and explicit spend authorization in `src/experiment.ts` and `src/cli.ts`
- [x] T017 [US2] Convert the historical twenty-run study into one example preset in `experiments/config.yaml`
- [x] T018 [US2] Delete fixed-condition and study-state runtime/tests in `src/condition.ts`, `src/condition.test.ts`, `src/study.ts`, `src/study.test.ts`, `src/configured-run.ts`, and `src/preflight.ts`

## Phase 5: User Story 3 - Inspect and Re-evaluate Complete Run Evidence (Priority: P2)

**Goal**: Publish one coherent run record and evaluate every canonical origin without selecting a best result.

**Independent Test**: Shared and isolated runs publish complete records, then re-evaluate frozen origins provider-free with prior evidence unchanged.

- [x] T019 [P] [US3] Add atomic record, trace-exclusion, interrupted-run, and re-evaluation history tests in `src/records.test.ts`, `src/trace.test.ts`, and `src/evaluate.test.ts`
- [x] T020 [P] [US3] Add shared-one-origin and isolated-every-origin acceptance tests in `src/evaluate.test.ts`
- [x] T021 [US3] Collapse protocol/attempt/study artifacts into resolved run records and append-only traces in `src/records.ts`, `src/trace.ts`, and `src/run.ts`
- [x] T022 [US3] Freeze and evaluate every canonical `main`, append re-evaluation results atomically, and preserve missing-integration outcomes in `src/evaluate.ts`, `src/experiment.ts`, and `src/cli.ts`
- [x] T023 [US3] Keep overlap observation as a separate post-publication, non-scoring Python analysis module

## Phase 6: Cleanup and Verification

- [x] T024 Rewrite active research guidance in `README.md`, `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`
- [x] T025 Remove superseded feature artifacts from `specs/009-refactor-puzzle-architecture/`, `specs/010-agent-sandbox-lifecycle/`, `specs/011-configurable-research-runs/`, `specs/012-simple-research-ci/`, `specs/013-engineered-paired-blocks/`, `specs/014-four-team-conditions/`, `specs/015-frozen-five-block-protocol/`, `specs/016-optional-team-channel/`, and `specs/019-configurable-run-controls/`
- [x] T026 Update active-boundary checks to reject fixed block/condition/phase and legacy state-machine references in `tests/integration/verification.test.ts`
- [x] T027 Run the provider-free commands in `specs/021-lean-experiment-engine/quickstart.md` and confirm the exact config-scoped gate blocks provider access on every invalid path

## Dependencies and Parallel Work

- T001-T004 establish governance and shared contracts. US1 (T005-T010) and the US2 verification tasks (T011-T012) can then proceed in parallel.
- US2 implementation (T013-T018) depends on prepared-package decoding from T009. US3 (T019-T023) depends on the resolved-run and execution path from US2.
- T005/T006, T011/T012, T019/T020, and documentation T024 can run in parallel within their phases because they target separate surfaces.
- Cleanup and full verification (T025-T027) follow all selected stories.

## Implementation Strategy

Complete US1 and the manifest decoder first to establish the minimum fixture-to-run path. Then replace the study executor, publish complete run evidence, and delete superseded machinery rather than maintaining two runtimes.
