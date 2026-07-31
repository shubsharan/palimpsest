# Tasks: Blind Calibration and Team-Level Evaluation

**Input**: Design documents from `/specs/020-blind-team-evaluation/` **Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Verification**: Tests are mandatory and written before the corresponding implementation. Paid calibration remains gated by a clean exact-commit preflight after every provider-free acceptance check passes.

**Organization**: Tasks are grouped by user story so the blind checker, all-origin evaluation, diagnostics, block gates, and calibration workflow remain independently testable.

## Phase 1: Setup and Governance

**Purpose**: Freeze the approved design and active feature guidance before implementation.

- [ ] T001 Validate Feature 020 specification, constitution v7.0.0, plan, contracts, and requirement checklist in specs/020-blind-team-evaluation/
- [ ] T002 [P] Reconcile active product and runtime guidance for blind checking and all-canonical-origin evaluation in README.md, docs/proposal.md, docs/architecture.md, docs/roadmap.md, AGENTS.md, and CLAUDE.md
- [ ] T003 [P] Replace reviewer-selection dimensions with trace-grounded recognition, integration, interference, checker-use, resource, and provenance dimensions in experiments/behavior-rubric.md and tests/fixtures/config/behavior-rubric.md
- [ ] T004 Confirm existing .gitignore, .dockerignore, formatter, linter, TypeScript, Python, Docker, and generated-artifact exclusions without broadening repository scope

---

## Phase 2: Foundational Strict Contracts

**Purpose**: Advance shared schemas and decoders before story-specific runtime behavior.

**Critical**: No runtime story begins until strict contract migration passes.

- [ ] T005 [P] Write failing schema-v5 manifest fixtures for checking/scoring policies, no reviewer selection, active block order, null token ceilings, model settings, and monetary ceilings in tests/fixtures/config/ and src/config.test.ts
- [ ] T006 [P] Write failing strict artifact tests for puzzle-build v4, attempt-summary v6, design-receipt v3, evaluation-record v2, canonical origins, diagnostics, and behavior-review references in src/artifacts.test.ts and src/test-helpers.ts
- [ ] T007 Migrate experiments/schema.json, experiments/config.yaml, tests/fixtures/config/*.yaml, and src/config.ts to study manifest v5 with explicit checking and scoring policies
- [ ] T008 Migrate strict TypeScript artifact types and decoders in src/artifacts.ts and src/test-helpers.ts to puzzle-build v4, attempt-summary v6, design-receipt v3, and evaluation-record v2
- [ ] T009 Propagate resolved checking/scoring policies and schema identities through src/run.ts, src/study.ts, src/experiment.ts, src/fixture.ts, src/offline.ts, and their tests
- [ ] T010 Run focused configuration and artifact suites with pnpm test:ts -- src/config.test.ts src/artifacts.test.ts src/run.test.ts src/study.test.ts src/experiment.test.ts

**Checkpoint**: New strict records round-trip and reject all old or mixed contract shapes.

---

## Phase 3: User Story 1 - Blind Published-Solver Checking (Priority: P1)

**Goal**: Preserve solver validation without exposing correctness during model work.

**Independent Test**: Correct and incorrect same-length outputs return identical non-commit feedback, all output failure classes are explicit, and filesystem guards prove no oracle path is opened.

### Verification for User Story 1

- [ ] T011 [P] [US1] Write failing Python tests for plaintext-independent word counts, bounded coverage, malformed text, incomplete output, and oracle non-access in python/tests/evaluation/test_checker.py
- [ ] T012 [P] [US1] Write failing TypeScript tool and published-solver tests for valid, missing, empty, malformed, oversized, timed-out, indeterminate, and unavailable-main outcomes in src/tools.test.ts and src/published-solver.test.ts
- [ ] T013 [P] [US1] Update prompt snapshots to require runnability-only interpretation and preserve unlimited observable checker use in src/prompt.test.ts and src/fixture.test.ts

### Implementation for User Story 1

- [ ] T014 [US1] Replace oracle-backed checking with ciphertext/output token coverage in python/palimpsest/evaluation/checker.py and src/checker.ts
- [ ] T015 [US1] Add strict published-runnability-coverage-v1 results and output-validity classification in src/published-solver.ts and src/tools.ts
- [ ] T016 [US1] Remove checker build-root/oracle dependencies while preserving trace observation in src/run.ts, src/released-stage.ts, src/tools.ts, and src/trace.ts
- [ ] T017 [US1] Update agent-visible checker instructions without changing tools, roles, Git freedom, or coordination in src/prompt.ts
- [ ] T018 [US1] Run blind-checker acceptance with pnpm test:ts -- src/tools.test.ts src/published-solver.test.ts src/prompt.test.ts src/fixture.test.ts src/run.test.ts and pnpm test:py -- python/tests/evaluation/test_checker.py

**Checkpoint**: Checker feedback is useful for packaging and coverage but identical for correct and incorrect same-length outputs.

---

## Phase 4: User Story 2 - Evaluate Every Canonical Team Artifact (Priority: P1)

**Goal**: Derive and evaluate the complete frozen canonical-origin set with no reviewer selection or artifact repair.

**Independent Test**: Shared attempts produce one terminal origin result, isolated attempts produce three, prohibited evaluator inputs fail, and all submission failures remain explicit per origin.

### Verification for User Story 2

- [ ] T019 [P] [US2] Write failing canonical-origin derivation and cardinality tests for CS, CR, IR, and IS in src/evaluate.test.ts
- [ ] T020 [P] [US2] Write failing CLI tests proving evaluate rejects workspace, notes, command, output path, branch, and ref inputs in tests/puzzle/cli.test.ts and tests/integration/verification.test.ts
- [ ] T021 [P] [US2] Write failing origin-terminal-status, literal-main, no-repair, output-provenance, and cleanup tests in src/evaluate.test.ts and tests/puzzle/attempt-durability.test.ts

### Implementation for User Story 2

- [ ] T022 [US2] Replace EvaluationSelection with canonical origin and origin-result records in src/artifacts.ts and src/evaluate.ts
- [ ] T023 [US2] Derive one shared or three private frozen origin targets and evaluate canonical command/output sequentially in src/evaluate.ts
- [ ] T024 [US2] Remove reviewer selection flags and alternate evaluator inputs from src/flags.ts, src/cli.ts, src/evaluate.ts, and README.md
- [ ] T025 [US2] Publish every terminal origin result atomically and keep trusted evaluation failures distinct in src/evaluate.ts and src/artifacts.ts
- [ ] T026 [US2] Wire automatic all-origin evaluation after durable attempt freeze in src/study.ts, src/experiment.ts, src/offline.ts, and src/fixture.ts
- [ ] T027 [US2] Run all-origin evaluation acceptance with pnpm test:ts -- src/evaluate.test.ts src/artifacts.test.ts tests/puzzle/cli.test.ts tests/puzzle/attempt-durability.test.ts

**Checkpoint**: No evaluator code path accepts or records a reviewer-selected workspace.

---

## Phase 5: User Story 3 - Diagnostic and Team-Level Outcomes (Priority: P1)

**Goal**: Add exact post-freeze diagnostic partitions, collective ceiling, and nullable integration-gap semantics.

**Independent Test**: Synthetic fixtures exactly cover every requested partition plus missing/extra tokens and every ceiling/gap state.

### Verification for User Story 3

- [ ] T028 [P] [US3] Add failing synthetic diagnostic tests for pre/post, changed/control, sentinel/specialist, stage, owner, changed type, macro accuracy, empty partition, missing token, and extra token cases in python/tests/evaluation/test_diagnostics.py
- [ ] T029 [P] [US3] Add failing collective-ceiling and integration-gap tests for shared, isolated, partial-failure, one-scoreable, and no-scoreable cases in src/evaluate.test.ts
- [ ] T030 [P] [US3] Add failing strict diagnostic and team-record decoder tests in src/artifacts.test.ts

### Implementation for User Story 3

- [ ] T031 [US3] Implement palimpsest-diagnostics-v1 position annotations and diagnostic scoring in python/palimpsest/evaluation/diagnostics.py and python/palimpsest/evaluation/score.py
- [ ] T032 [US3] Add the trusted diagnostic Python bridge and decode validation in src/evaluate.ts and src/artifacts.ts
- [ ] T033 [US3] Compute position-wise collective ceiling without persisting synthetic reconstruction text in src/evaluate.ts
- [ ] T034 [US3] Implement realized-team-product and nullable integration-gap rules with explicit reasons in src/evaluate.ts
- [ ] T035 [US3] Retain post-freeze diagnostic and team outcomes in evaluation-record v2 and attempt-summary v6 through src/artifacts.ts and src/study.ts
- [ ] T036 [US3] Run diagnostic and team-level acceptance with pnpm test:py -- python/tests/evaluation/test_diagnostics.py python/tests/evaluation/test_score.py and pnpm test:ts -- src/evaluate.test.ts src/artifacts.test.ts src/study.test.ts

**Checkpoint**: Aggregate scoring remains primary while every scored origin receives exact diagnostics and every attempt receives honest team-level semantics.

---

## Phase 6: User Story 4 - Seal Strong Fresh Study Blocks (Priority: P2)

**Goal**: Separate evidence and control quality and make source parsing, validation, sealing, and publication one fail-closed workflow.

**Independent Test**: Eligible unregistered text seals byte-identically, while malformed, short, fallback, or inadequate input publishes nothing and causes zero credential reads or adapter creation.

### Verification for User Story 4

- [x] T037 [P] [US4] Write failing evidenceTier/controlTier serialization, ordering, completeness, and phase-gate tests in python/tests/puzzle/test_manifest.py and python/tests/puzzle/test_block.py
- [x] T038 [P] [US4] Write failing first-20-percent, 16k-to-20k, first-qualifying, bounded-search, and no-weakening tests in python/tests/puzzle/test_block.py and python/tests/puzzle/test_build.py
- [x] T039 [P] [US4] Write failing pre-credential and pre-adapter rejection tests for fallback or inadequate evidence in src/study.test.ts and tests/puzzle/experiment.test.ts

### Implementation for User Story 4

- [x] T040 [US4] Split evidence and control tier calculation and phase eligibility in python/palimpsest/puzzle/block.py
- [x] T041 [US4] Advance puzzle-build v4 serialization and paired-build identity in python/palimpsest/puzzle/manifest.py, python/palimpsest/puzzle/build.py, src/artifacts.ts, and src/build.ts
- [x] T042 [US4] Accept ordinary UTF-8 prose and Gutenberg text/HTML directly from `--source` in python/palimpsest/puzzle/corpus.py
- [x] T043 [US4] Replace public catalog discovery and pin promotion with one atomic source-to-build path in python/palimpsest/puzzle/build.py and src/build.ts
- [x] T044 [US4] Derive source identity and seed from supplied bytes and seal the selected window, allocation, manipulation, tiers, and phase result in puzzle-build v4
- [x] T045 [US4] Enforce paid-calibration and validation phase gates before credentials or adapters in src/study.ts and src/experiment.ts
- [x] T046 [US4] Run accepted/rejected source workflow tests plus pnpm test:py -- python/tests/puzzle/test_block.py python/tests/puzzle/test_build.py python/tests/puzzle/test_manifest.py and pnpm test:ts -- src/build.test.ts src/study.test.ts tests/puzzle/cli.test.ts tests/puzzle/experiment.test.ts

**Checkpoint**: One command either publishes a complete phase-eligible sealed build or exits nonzero with no partial output.

---

## Phase 7: User Story 5 - Run One Fresh Calibration and Stop (Priority: P2)

**Goal**: Produce one fully instrumented four-cell GPT-5.6-sol calibration and stop before validation.

**Independent Test**: The provider-free coordinator completes CS, CR, IR, and IS sequentially with automatic origin evaluation and behavior records, then the exact preflight-bound paid phase does the same without launching validation.

### Verification for User Story 5

- [ ] T047 [P] [US5] Write failing behavior-review schema and trace-grounding tests for communication, integration, interference, recovery, belief replacement, recognition, checker interpretation, usage, reasoning-summary coverage, and provenance in src/artifacts.test.ts and src/trace.test.ts
- [ ] T048 [P] [US5] Write failing provider-free four-cell tests for order, one-hour schedule, null token cutoff, channel treatment, $40 authorization, automatic evaluation/review, and stop-before-validation in tests/puzzle/experiment.test.ts and tests/puzzle/offline.test.ts
- [ ] T049 [P] [US5] Write failing prompt and manifest snapshots for three GPT-5.6-sol medium-reasoning agents and runnability-only checking in src/prompt.test.ts and src/config.test.ts

### Implementation for User Story 5

- [ ] T050 [US5] Implement strict post-freeze behavior-review generation and artifact publication in src/artifacts.ts, src/study.ts, and src/trace.ts
- [ ] T051 [US5] Freeze GPT-5.6-sol medium reasoning, null token ceilings, one-hour schedule, and $10/$40 monetary authorization in experiments/config.yaml
- [ ] T052 [US5] Make calibration expansion exactly CS, CR, IR, IS and prevent automatic validation continuation in src/study.ts and src/experiment.ts
- [ ] T053 [US5] Complete the full provider-free CS/CR/IR/IS fixture and verify every canonical terminal evaluation, diagnostic, behavior, usage, and provenance record with pnpm puzzle:offline and tests/puzzle/offline.test.ts
- [ ] T054 [US5] Run pnpm ci:local, pnpm verify, formatting, link, schema-version, stale-contract, and git diff checks on the complete implementation
- [ ] T055 [US5] Commit the exact verified source and sealed catalog on branch 020-blind-team-evaluation
- [ ] T056 [US5] Run clean receipt-bound pnpm preflight and confirm artifacts/preflight.json matches the committed revision and precise runnable sandbox
- [ ] T057 [US5] Create a fresh ignored study root and immutable design receipt, then run the paid CS, CR, IR, and IS calibration sequentially with the existing OpenAI credential
- [ ] T058 [US5] Verify terminal outcomes for every canonical origin, diagnostic sentinel/specialist separation, behavior/recognition/resource records, no correctness disclosure, authorization at or below $40, and zero validation attempts

**Checkpoint**: Calibration evidence is ready for review; validation remains deliberately unstarted.

---

## Dependencies and Execution Order

### Phase Dependencies

- Setup and governance has no dependency.
- Foundational contracts depend on the approved setup artifacts and block all runtime stories.
- US1, US2, and the Python portion of US3 may begin after foundational contracts, but US3 integration depends on US2 origin records.
- US4 may begin after foundational contracts and must finish before any provider-backed work.
- US5 depends on US1 through US4 and every provider-free gate.

### User Story Dependencies

- **US1**: Independently proves the agent-visible checker boundary.
- **US2**: Independently proves canonical target derivation and evaluation cardinality.
- **US3**: Its scorer is independent; durable integration depends on US2.
- **US4**: Independently proves block strength and catalog freshness.
- **US5**: Integrates all prior stories and is the only paid phase.

### Parallel Opportunities

- T002 and T003 can run in parallel.
- T005 and T006 can run in parallel before sequential migration.
- Test-writing tasks inside each story marked `[P]` touch distinct files.
- US1 checker work and US4 Python design work touch separate subsystems after foundational contracts.
- Provider-free TypeScript and Python focused suites can run independently before full verification.

## Implementation Strategy

1. Advance strict records before changing runtime behavior.
2. Deliver the blind checker as the first independently verifiable slice.
3. Replace reviewer selection with native origin evaluation.
4. Add diagnostics and team-level derivations on that origin set.
5. Rebuild and seal the stronger catalog before any credential access.
6. Integrate behavior records and the four-cell provider-free fixture.
7. Commit, preflight the exact clean source, run calibration once, and stop.

## Notes

- Tasks marked `[P]` are parallelizable only when their listed prerequisite phase is complete.
- Every completed implementation task must be marked `[x]`.
- Historical Feature 017/018 artifacts are immutable and receive no schema migration.
- No task may introduce roles, turns, required reports, merge procedures, consensus rules, checker-call limits, retries, or origin repair.
