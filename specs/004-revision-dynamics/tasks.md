# Tasks: Revision Dynamics

**Input**: Design documents from `/specs/004-revision-dynamics/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Verification**: Tests precede behavior and cover contract parity, generation invariants, monotonic reveal, solver isolation, scoring, decision, and replay.

## Phase 1: Setup

**Purpose**: Add the Gate C module surfaces without starting a judged run.

- [x] T001 Add Gate C package and tool directories in `python/src/palimpsest/gate_c/`, `python/tests/gate_c/`, `tools/gate-c/`, and `tests/gate-c/`
- [x] T002 Add Gate C offline, predeclaration, run, scoring, and replay commands to `package.json`
- [x] T003 [P] Define frozen Gate C calibration constants and paths in `python/src/palimpsest/gate_c/config.py`
- [x] T004 [P] Define TypeScript clock, attempt, and API configuration types in `tools/gate-c/config.ts`

---

## Phase 2: Foundational Contracts and Provenance

**Purpose**: Establish the versioned cross-runtime boundary and immutable evidence identity before implementing experiment behavior.

- [x] T005 Create version 1 Gate C schemas in `packages/contracts/schemas/revision-instance.schema.json`, `packages/contracts/schemas/reveal-plan.schema.json`, `packages/contracts/schemas/reveal-event.schema.json`, `packages/contracts/schemas/solver-checkpoint.schema.json`, `packages/contracts/schemas/revision-trajectory.schema.json`, and `packages/contracts/schemas/gate-c-decision.schema.json`
- [x] T006 Register the six Gate C contract identifiers in `packages/contracts/src/index.ts` and `python/src/palimpsest/contracts/schemas.py`
- [x] T007 [P] Add valid and invalid Gate C golden fixtures to `packages/contracts/fixtures/` and its `manifest.json`
- [x] T008 [P] Add TypeScript Gate C contract parity tests in `tests/gate-c/contracts.test.ts`
- [x] T009 [P] Add Python Gate C contract parity tests in `python/tests/gate_c/test_gate_c_contracts.py`
- [x] T010 Implement declaration-digest and run-ID-bound immutable attempt paths plus atomic `current.json` updates in `python/src/palimpsest/gate_c/artifacts.py`
- [x] T011 Add artifact isolation and explicit-attempt import tests in `python/tests/gate_c/test_artifacts.py`

**Checkpoint**: Both runtimes agree on every Gate C contract and no mutable pointer can become evidence.

---

## Phase 3: User Story 1 - Observe a Localized Belief Failure (Priority: P1)

**Goal**: Generate one valid two-regime instance and expose contradictory evidence on an agent-independent reveal clock.

**Independent Test**: Build the frozen instance twice, verify identical bytes, then replay the reveal plan with an injected clock and show that changed mappings become contradicted while matched stable controls do not.

### Verification for User Story 1

- [x] T012 [P] [US1] Add property tests for selection, strata coverage, matching uniqueness, and key-composition invariants in `python/tests/gate_c/test_revision.py`
- [x] T013 [P] [US1] Add deterministic instance geometry and public-projection leakage tests in `python/tests/gate_c/test_instance.py`
- [x] T014 [P] [US1] Add monotonic, atomic, behavior-independent reveal tests with a fake clock in `tests/gate-c/reveal-clock.test.ts`
- [x] T015 [P] [US1] Add stationary no-switch control scoring tests in `python/tests/gate_c/test_scoring.py`

### Implementation for User Story 1

- [x] T016 [P] [US1] Implement active-on-both-sides selection, four strata, matched controls, and selected-image re-keying in `python/src/palimpsest/gate_c/revision.py`
- [x] T017 [US1] Build the 27,504-token chapter-aligned private instance and redacted public projection in `python/src/palimpsest/gate_c/instance.py`
- [x] T018 [US1] Generate the six-slot reveal plan and contradiction-threshold oracle fields in `python/src/palimpsest/gate_c/instance.py`
- [x] T019 [P] [US1] Implement the injectable monotonic clock and durable event write in `tools/gate-c/clock.ts`
- [x] T020 [US1] Implement chapter-atomic release ordering and solver-request handoff in `tools/gate-c/reveal-runner.ts`
- [x] T021 [US1] Emit disposable calibration artifacts and reject them from judged promotion in `python/src/palimpsest/gate_c/instance.py`

**Checkpoint**: The revision mechanic and reveal geometry are observable without an external model call.

---

## Phase 4: User Story 2 - Detect and Selectively Adapt (Priority: P2)

**Goal**: Run one continuous solver condition, retain observable work as it happens, and measure selective adaptation.

**Independent Test**: Use a fake Responses client to stream six releases through one container and response chain, validate ordered checkpoints, then score a fixture containing detection, changed recovery, and stable retention.

### Verification for User Story 2

- [x] T022 [P] [US2] Add streamed event, container reuse, response chaining, and quota-failure tests in `tests/gate-c/solver-runner.test.ts`
- [x] T023 [P] [US2] Add checkpoint ordering, mapping history, latency, and false-retraction tests in `python/tests/gate_c/test_scoring.py`
- [x] T024 [P] [US2] Add network, oracle, future-file, and malformed-checkpoint isolation tests in `tests/gate-c/solver-isolation.test.ts`

### Implementation for User Story 2

- [x] T025 [P] [US2] Implement ordered checkpoint validation and trajectory scoring in `python/src/palimpsest/gate_c/scoring.py`
- [x] T026 [US2] Implement explicit network-disabled container creation, incremental uploads, `previous_response_id` chaining, and event streaming in `tools/gate-c/solver-runner.ts`
- [x] T027 [US2] Persist `live.jsonl`, raw API events, response objects, uploaded-file receipts, and solver-created outputs in the exact attempt directory in `tools/gate-c/solver-runner.ts`
- [x] T028 [US2] Add the structured checkpoint prompt and reject-without-repair importer in `tools/gate-c/solver-runner.ts`

**Checkpoint**: A fake client proves the live path end to end; the real judged call remains gated by admission and quota.

---

## Phase 5: User Story 3 - Make a Gate C Decision (Priority: P3)

**Goal**: Apply the frozen pass, rework, stop, or invalid rule and produce independently replayable evidence.

**Independent Test**: Feed pass, single-dial rework, stop, and integrity-failure fixtures through decision and replay and verify identical TypeScript/Python verdicts and digests.

### Verification for User Story 3

- [x] T029 [P] [US3] Add pass, rework, stop, and invalid decision tests in `python/tests/gate_c/test_decision.py`
- [x] T030 [P] [US3] Add exact regeneration, score recomputation, tamper, and pointer-independence tests in `python/tests/gate_c/test_replay.py`
- [x] T031 [P] [US3] Add TypeScript report and cross-runtime replay tests in `tests/gate-c/replay.test.ts`

### Implementation for User Story 3

- [x] T032 [P] [US3] Implement the frozen decision predicates and single-owning-dial rework rule in `python/src/palimpsest/gate_c/decision.py`
- [x] T033 [US3] Implement deterministic instance, reveal, score, decision, and digest replay in `python/src/palimpsest/gate_c/replay.py`
- [x] T034 [US3] Implement Gate C predeclaration and completion commands in `tools/gate-c/report.ts`
- [x] T035 [US3] Implement the explicit-attempt replay command in `tools/gate-c/replay.ts`
- [x] T036 [US3] Emit `gateDAuthorization: minimal-only` and `fullHarnessAuthorized: false` only for a valid pass in `tools/gate-c/report.ts`

**Checkpoint**: Gate C can reach an honest terminal decision from immutable evidence.

---

## Phase 6: Verification and Handoff

**Purpose**: Verify the reusable offline slice and defer the judged result until the complete Milestone 6 harness passes.

- [x] T037 [P] Add Gate C public-artifact redaction checks to `tests/contract/foundation-boundaries.test.ts`
- [x] T038 [P] Update root formatting, linting, typecheck, and contract comparison coverage for Gate C files in `package.json`
- [x] T039 Run `pnpm gate-c:calibrate` twice and record matching instance and reveal-plan digests in `artifacts/gate-c/calibration/`
- [x] T040 Run `pnpm verify` and `git diff --check`
- [x] T041 Validate every command and claim in `specs/004-revision-dynamics/quickstart.md`
- [x] T042 Run `pnpm gate-c:admit` and classify insufficient quota as an execution prerequisite without changing the model in `artifacts/gate-c/admission.json`
- [ ] T043 Run one declaration-bound judged attempt only after Milestone 6 passes and admission succeeds, then retain its exact identity under `artifacts/gate-c/attempts/`
- [ ] T044 Score, complete, and replay the exact attempt, then record Gate C status in `docs/roadmap.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- Setup has no dependencies.
- Foundational contracts depend on setup and block all user stories.
- User Story 1 depends on the foundational contracts.
- User Story 2 depends on User Story 1's instance, reveal plan, and runner boundary.
- User Story 3 depends on the trajectory emitted by User Story 2.
- Verification and handoff depend on the desired user-story increment. The judged-run tasks additionally depend on the passing Milestone 6 offline-harness report and successful API admission.

### User Story Dependencies

- **User Story 1** is the offline MVP and independently establishes that the generated intervention is localized and observable.
- **User Story 2** adds one solver and can be tested independently with a fake API client.
- **User Story 3** consumes immutable trajectories and can be tested independently with fixtures before any judged run.

### Parallel Opportunities

- T003 and T004 can proceed in parallel.
- T007, T008, and T009 can proceed after schema registration with separate fixture and runtime files.
- T012 through T015 are independent failing-test tasks.
- T016 and T019 use separate runtimes and can proceed in parallel.
- T022 through T024 are independent solver-boundary tests.
- T029 through T031 are independent decision and replay tests.
- T037 and T038 are separate verification surfaces.

## Parallel Example: User Story 1

```text
Task T012: revision selection and key property tests
Task T013: instance geometry and leakage tests
Task T014: monotonic reveal-clock tests
Task T015: stationary no-switch scoring control
```

## Parallel Example: User Story 2

```text
Task T022: streamed API and continuity tests
Task T023: trajectory and latency tests
Task T024: isolation and malformed-checkpoint tests
```

## Parallel Example: User Story 3

```text
Task T029: decision-state tests
Task T030: Python replay tests
Task T031: TypeScript cross-runtime replay tests
```

## Implementation Strategy

### MVP First

1. Complete setup and cross-runtime contracts.
2. Implement User Story 1 with offline calibration only.
3. Verify localized intervention and reveal geometry before spending API quota.

### Incremental Delivery

1. Add the fake-client solver path and live event stream.
2. Add deterministic scoring, decision, and replay.
3. Freeze one declaration.
4. Integrate this slice into the complete offline harness and pass Milestone 6.
5. Admit and run the real solver only when the harness and quota prerequisites both pass.
6. Move to Gate D only after a valid Gate C pass.

## Notes

- Tests must fail before their implementation task is completed.
- Calibration and fake-client outputs are never judged evidence.
- No task authorizes re-expanding Gate B. Multi-agent harness construction is owned by Milestones 4–6 and must finish before T043.
- Optional Spec Kit Git hooks are not part of task completion unless the user requests commits.
