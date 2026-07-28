# Tasks: Configurable Research Runs

**Input**: Design documents from `/specs/011-configurable-research-runs/` **Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Verification**: Tests are mandatory and precede implementation. No task may use a live provider call.

**Organization**: Tasks are grouped by user story so configuration/provider execution, variable puzzle conditions, and durable research sharing remain independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it targets different files and has no incomplete dependency.
- **[Story]**: Maps the task to the specification user story.

## Phase 1: Setup

**Purpose**: Add the pinned configuration/provider dependencies and checked-in experiment interface.

- [x] T001 Add pinned AI SDK, provider, Zod, YAML, and Ajv dependencies plus `puzzle:experiment` and experiment formatting inputs in `package.json` and `pnpm-lock.yaml`
- [x] T002 [P] Add the strict version-1 manifest schema and current three-agent baseline example in `experiments/schema.json` and `experiments/config.yaml`
- [x] T003 [P] Add explicit source path and format fields for every registered corpus in `fixtures/corpus/provenance.json`

---

## Phase 2: Foundational Contracts

**Purpose**: Establish dynamic identities, strict current-version records, and secret-safe model metadata before user-story composition.

**CRITICAL**: User-story implementation depends on these contracts.

- [x] T004 Add failing dynamic agent-ID, model-binding, build-v2, attempt-v2, and experiment-summary decoder tests in `src/artifacts.test.ts` and `src/model.test.ts`
- [x] T005 Add generated agent IDs, provider/model identity types, normalized usage detail, and per-turn response identity in `src/model.ts`
- [x] T006 Implement strict build-v2, attempt-v2, dynamic-session, model-binding, and experiment-summary decoders/writers in `src/artifacts.ts`
- [x] T007 Update shared fixture/test builders for dynamic identities and schema-v2 records in `src/test-helpers.ts` and `tests/golden/behavior.json`
- [x] T008 Run `src/artifacts.test.ts` and `src/model.test.ts`, then mark T004-T007 complete only when the foundational contracts pass

**Checkpoint**: Dynamic current-version records and model identities are available to every story.

---

## Phase 3: User Story 1 - Declare and Run One Research Experiment (Priority: P1)

**Goal**: Parse one strict manifest and run homogeneous or mixed direct-provider conditions without source edits.

**Independent Test**: A fixture-backed manifest with one homogeneous and one mixed three-agent condition resolves before side effects and assigns the declared model to each session.

### Verification for User Story 1

- [x] T009 [P] [US1] Add strict YAML/schema/semantic/secret validation tests in `src/config.test.ts`
- [x] T010 [P] [US1] Replace OpenAI-specific provider tests with mocked AI SDK first/continuation turn, factory, abort, usage, settings, fallback rejection, and credential-scrubbing tests in `src/provider.test.ts`
- [x] T011 [P] [US1] Add mixed adapter assignment and provider-infrastructure session tests in `src/run.test.ts` and `src/session.test.ts`
- [x] T012 [US1] Add CLI contract tests for config-based build/run and six-command dispatch in `tests/puzzle/cli.test.ts`

### Implementation for User Story 1

- [x] T013 [US1] Implement YAML parsing, Ajv validation, semantic reference resolution, safe provider settings, credential preflight, and resolved non-secret configuration in `src/config.ts`
- [x] T014 [US1] Replace the OpenAI Responses implementation with one AI SDK turn adapter and four direct provider factories in `src/provider.ts`
- [x] T015 [US1] Preserve provider-reported response identity and scrubbed infrastructure errors through the session lifecycle in `src/session.ts`
- [x] T016 [US1] Accept one model binding/adapter per declared agent and record the resolved run condition in `src/run.ts`
- [x] T017 [US1] Route config-based build/run and the new experiment subcommand through `src/cli.ts`, `src/build.ts`, and `package.json`
- [x] T018 [US1] Run the focused config, provider, session, run, and CLI suites without provider credentials or external calls

**Checkpoint**: One three-agent manifest can select direct providers or mixed fixture adapters through the provider-neutral boundary.

---

## Phase 4: User Story 2 - Vary Reproducible Puzzle Conditions (Priority: P2)

**Goal**: Build and run registered-corpus puzzles with dynamic agents/stages and zero or more successive partial re-keys.

**Independent Test**: Fixed feasible configurations for 2, 3, and 5 agents with zero, one, and two re-keys rebuild byte-identically; invalid or infeasible geometry fails explicitly.

### Verification for User Story 2

- [x] T019 [P] [US2] Add corpus registry, digest, one-based chapter, and TOC-filtering tests in `python/tests/puzzle/test_corpus.py`
- [x] T020 [P] [US2] Add dynamic stream, adjacent-regime eligibility, successive revision, and infeasible geometry tests in `python/tests/puzzle/test_shards.py` and `python/tests/puzzle/test_primitives.py`
- [x] T021 [P] [US2] Replace fixed-manifest tests with schema-v2 dynamic agents, stages, re-keys, key versions, ordering, and path validation in `python/tests/puzzle/test_manifest.py`
- [x] T022 [P] [US2] Add deterministic 2/3/5-agent, zero/one/two-re-key build and checker tests in `python/tests/puzzle/test_build.py` and `python/tests/evaluation/test_checker.py`
- [x] T023 [P] [US2] Add dynamic prompt, Git workspace, trace identity, reveal, and evaluator workspace tests in `src/prompt.test.ts`, `src/git.test.ts`, `src/trace.test.ts`, `src/reveal.test.ts`, and `src/evaluate.test.ts`

### Implementation for User Story 2

- [x] T024 [US2] Make provenance the verified corpus registry, use one-based chapters, and discard leading TOC chapter matches in `python/palimpsest/puzzle/corpus.py` and `fixtures/corpus/provenance.json`
- [x] T025 [US2] Parameterize stream assignment and adjacent-regime evidence calculations in `python/palimpsest/puzzle/shards.py` and successive key derivation in `python/palimpsest/puzzle/revision.py`
- [x] T026 [US2] Implement the dynamic schema-v2 puzzle and stage model in `python/palimpsest/puzzle/manifest.py` and `python/palimpsest/puzzle/__init__.py`
- [x] T027 [US2] Build dynamic agent/stage streams, versioned oracle keys, and zero-or-more re-keys from canonical JSON input in `python/palimpsest/puzzle/build.py`
- [x] T028 [US2] Validate checker agents against the decoded build rather than static constants in `python/palimpsest/evaluation/checker.py`
- [x] T029 [US2] Generate dynamic workspaces, prompts, reveal counts, trace identities, and evaluator workspace validation in `src/git.ts`, `src/prompt.ts`, `src/reveal.ts`, `src/trace.ts`, `src/evaluate.ts`, `src/tools.ts`, and `src/run.ts`
- [x] T030 [US2] Pass resolved puzzle JSON through the trusted Python bridge and consume build schema v2 in `src/python.ts`, `src/build.ts`, `src/checker.ts`, and `src/artifacts.ts`
- [x] T031 [US2] Run the complete Python puzzle/evaluation suites and focused dynamic TypeScript suites, then update the baseline golden only for intentional schema/identity changes

**Checkpoint**: The configured scientific dimensions reproduce for fixed inputs and every runtime owner follows the declared dynamic agent set.

---

## Phase 5: User Story 3 - Review and Share Comparable Results (Priority: P3)

**Goal**: Preserve an incrementally indexed, secret-free set of attempts for later reviewer-selected evaluation.

**Independent Test**: A multi-condition fixture experiment publishes `experiment.json` after each attempt, stops after a recorded provider infrastructure failure, preserves prior attempts, leaks no canary secret, and supports later evaluation.

### Verification for User Story 3

- [x] T032 [P] [US3] Add sequential repetition, atomic summary, later-failure durability, and infrastructure-stop tests in `src/experiment.test.ts`
- [x] T033 [P] [US3] Add black-box fixture experiment, secret-canary, no-retry, and later reviewer-evaluation tests in `tests/puzzle/experiment.test.ts`
- [x] T034 [P] [US3] Extend attempt durability and trace tests for dynamic model metadata and publication-before-overlap in `tests/puzzle/attempt-durability.test.ts` and `src/trace.test.ts`

### Implementation for User Story 3

- [x] T035 [US3] Implement sequential condition/repetition execution and atomic experiment-summary publication in `src/experiment.ts`
- [x] T036 [US3] Stop an experiment after indexing any attempt with an infrastructure-error session while preserving normal model outcomes in `src/experiment.ts` and `src/run.ts`
- [x] T037 [US3] Keep reviewer-selected evaluation independent while accepting dynamic attempt workspaces in `src/evaluate.ts`
- [x] T038 [US3] Run focused experiment, durability, trace, and evaluation suites and inspect generated records for secret canaries

**Checkpoint**: A researcher can retain, inspect, share, and later evaluate every durable configured attempt.

---

## Phase 6: Documentation and Cross-Cutting Acceptance

**Purpose**: Reconcile the authoritative puzzle description and verify the complete local research path.

- [x] T039 [P] Update the configurable default puzzle, provider-neutral model conditions, and claim limits in `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`
- [x] T040 [P] Update canonical manifest/CLI guidance and active plan pointers in `README.md`, `AGENTS.md`, and `CLAUDE.md`
- [x] T041 [P] Extend active-layout/reference verification for the experiment schema, removed provider-specific flags, and dynamic-agent ownership in `tests/integration/verification.test.ts`
- [x] T042 Format all changed TypeScript, Python, JSON, YAML, Markdown, and lockfile inputs with the configured formatters
- [x] T043 Run focused TypeScript/Python tests, type checking, linting, and `git diff --check`
- [ ] T044 Build the sandbox and run full `pnpm verify` with no live provider credentials (blocked only by installed Docker 29.6.2 differing from the repository pin 29.2.1; the fresh sandbox build and all subsequent checks pass when run independently)
- [x] T045 Execute the fresh offline flow and a fixture-backed multi-condition experiment from `quickstart.md`, decode every generated artifact, and confirm reviewer-selected evaluation
- [x] T046 Audit FR-001 through FR-032 and SC-001 through SC-009 against source, tests, documentation, and fresh artifacts, then mark every completed task in this file

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup** starts immediately.
- **Foundational Contracts** depends on Setup and blocks all stories.
- **User Story 1** depends on Foundational Contracts.
- **User Story 2** depends on the resolved config/build contracts from User Story 1 but its Python tests and implementation can proceed in parallel with provider work after T013's puzzle shape is stable.
- **User Story 3** depends on durable attempts from User Stories 1 and 2.
- **Documentation and Acceptance** depends on all desired stories.

### Parallel Opportunities

- T002 and T003 target independent checked-in interfaces.
- T009-T011 cover independent config, provider, and lifecycle owners.
- T019-T023 cover independent Python and TypeScript dynamic-geometry surfaces.
- T032-T034 cover independent experiment, black-box, and durability tests.
- T039-T041 cover independent documentation and verification surfaces.

### Subagent Ownership

```text
Provider/config subagent: T009-T015
Python geometry subagent: T019-T028
Runtime/experiment subagent: T011-T012, T016-T018, T023, T029-T038
Primary agent: contracts, integration, documentation, full verification, and conflict resolution
```

## Implementation Strategy

1. Land setup and strict current-version contracts.
2. Implement manifest/provider execution for the baseline three-agent case.
3. Generalize deterministic puzzle and runtime geometry.
4. Add sequential experiment durability and later evaluation.
5. Reconcile authoritative docs and run the complete no-network verification path.

## Notes

- Tests must fail for the intended missing behavior before their implementation task is marked complete.
- Do not add compatibility aliases for Feature 009 provider-specific flags or schema-v1 artifacts.
- Do not perform live provider calls in tests or acceptance.
- Do not mark a task complete until its stated focused verification passes.
