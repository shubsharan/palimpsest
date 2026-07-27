# Tasks: Runner Hardening and Greenfield Cleanup

**Input**: Design documents from `/specs/008-runner-hardening-cleanup/` **Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Verification**: Tests are mandatory for sandbox isolation, path containment, trace chronology, reachable Git history, deterministic puzzle mechanics, active boundaries, and the fresh offline path.

**Organization**: Tasks are grouped by independently testable operator and maintainer stories.

## Phase 1: Setup

**Purpose**: Establish the new runtime and verification surfaces without changing puzzle behavior.

- [x] T001 Add the digest-pinned sandbox image and local build command in `containers/puzzle-sandbox/Dockerfile` and `tools/puzzle/sandbox-build.ts`
- [x] T002 Remove the legacy machine-specific image lock and add the root sandbox operator script in `containers/images.lock.json` and `package.json`
- [x] T003 [P] Add neutral active corpus paths and reduced provenance under `fixtures/corpus/`
- [x] T004 [P] Add shared sandbox test fixtures and command fakes in `packages/puzzle-runner/tests/helpers.ts`

---

## Phase 2: Foundational

**Purpose**: Define the executor and artifact primitives required by the three stories.

- [x] T005 Add failing contract tests for sandbox identity, allowlisted environment, fixed limits, mounts, timeout, cancellation, and output overflow in `packages/puzzle-runner/tests/sandbox.test.ts`
- [x] T006 Implement `CommandSandbox`, `DockerCommandSandbox`, sandbox inspection, and process termination in `packages/puzzle-runner/src/sandbox.ts`
- [x] T007 Export sandbox contracts for injection from `packages/puzzle-runner/src/index.ts`
- [x] T008 Add failing resumable trace validation tests in `packages/puzzle-runner/tests/observations.test.ts`
- [x] T009 Implement trace metadata creation, reopening, validation, redaction, and monotonic clamping in `packages/puzzle-runner/src/observations.ts`

**Checkpoint**: The injected command and observation boundaries are testable independently.

---

## Phase 3: User Story 1 - Run Without Host Exposure (Priority: P1)

**Goal**: Execute agent and reviewer commands with only their declared puzzle surfaces.

**Independent Test**: Run containment probes and ordinary shared Git operations through the deterministic fixture; declared access succeeds and every undeclared host, peer, oracle, credential, symlink, and network probe fails.

### Verification for User Story 1

- [x] T010 [P] [US1] Add failing regular-file and symlink-escape tests for checker candidates in `packages/puzzle-runner/tests/tools.test.ts`
- [x] T011 [P] [US1] Add failing evaluator mount, environment, ciphertext, output, and symlink tests in `packages/puzzle-runner/tests/evaluator.test.ts`
- [x] T012 [P] [US1] Add failing agent mount/prompt and shared-Git integration tests in `packages/puzzle-runner/tests/supervisor.test.ts` and `packages/puzzle-runner/tests/prompt.test.ts`
- [x] T013 [US1] Add a failing real-container containment scenario covering host, peer, oracle, credentials, network, ordinary Git, and orphan-free cleanup after every termination path in `tests/puzzle/sandbox.integration.test.ts`

### Implementation for User Story 1

- [x] T014 [US1] Route `run_command` through the injected sandbox, classify sandbox failures as session infrastructure errors, and harden candidate resolution in `packages/puzzle-runner/src/tools.ts` and `packages/puzzle-runner/src/session.ts`
- [x] T015 [US1] Configure stable container paths, evidence/reference/shared-Git mounts, and sandbox metadata in `packages/puzzle-runner/src/supervisor.ts`, `packages/puzzle-runner/src/git.ts`, and `packages/puzzle-runner/src/prompt.ts`
- [x] T016 [US1] Route reviewer execution through the injected sandbox and validate output containment in `packages/puzzle-runner/src/evaluator.ts`
- [x] T017 [US1] Create and inject the Docker sandbox, require the attempt-recorded image ID for evaluation, and remove the final host executor after all callers migrate in `tools/puzzle/run.ts`, `tools/puzzle/evaluate.ts`, `tools/puzzle/offline.ts`, and `packages/puzzle-runner/src/tools.ts`

**Checkpoint**: The fixture can collaborate and evaluate without host-shell execution.

---

## Phase 4: User Story 2 - Inspect a Truthful Attempt Record (Priority: P2)

**Goal**: Preserve chronological post-run events and observe all reachable committed text.

**Independent Test**: Commit and delete a unique fragment, finish the run, append overlap and evaluation events, and verify reachable inclusion plus strict sequence and nondecreasing elapsed times.

### Verification for User Story 2

- [x] T018 [P] [US2] Add failing cross-process overlap/evaluation chronology tests in `tests/puzzle/offline.test.ts`
- [x] T019 [P] [US2] Add failing committed-then-deleted, multi-ref, repeated-tree-reference, unique-blob, and binary object tests in `tests/puzzle/overlap-git.test.ts`
- [x] T020 [P] [US2] Extend Python overlap tests for scan metadata and unchanged observational scoring in `python/tests/puzzle/test_overlap.py`

### Implementation for User Story 2

- [x] T021 [US2] Replace ad-hoc post-run appends with reopened observation logs in `tools/puzzle/common.ts`, `tools/puzzle/run.ts`, and `tools/puzzle/evaluate.ts`
- [x] T022 [US2] Scan unique reachable text blobs by object ID and separately count repeated reachable commit-tree references in `tools/puzzle/run.ts`
- [x] T023 [US2] Emit trace metadata, sandbox identity, and overlap scan counts in `tools/puzzle/run.ts` and `packages/puzzle-runner/src/supervisor.ts`
- [x] T024 [US2] Preserve overlap scoring behavior while accepting scan metadata in `python/src/palimpsest/puzzle/overlap.py`

**Checkpoint**: One build-run-overlap-evaluate record is chronological and complete for current-ref Git history.

---

## Phase 5: User Story 3 - Work in the Current Runner Only (Priority: P3)

**Goal**: Remove the superseded Gate-era implementation and retain only the active runner dependency closure.

**Independent Test**: From a clean checkout, fixed inputs reproduce the puzzle build and score, active-boundary searches find no legacy imports, and the full verification suite passes.

### Verification for User Story 3

- [x] T025 [P] [US3] Rewrite active package, import, artifact, specification, CLI-contract, and dependency-allowlist boundary tests in `tests/integration/verification.test.ts` and `tests/puzzle/cli.test.ts`
- [x] T026 [P] [US3] Update puzzle tests to import only `palimpsest.puzzle` helpers in `python/tests/puzzle/`
- [x] T027 [US3] Capture and assert deterministic build geometry and scores across corpus relocation in `python/tests/puzzle/test_build.py` and `python/tests/puzzle/test_score.py`

### Implementation for User Story 3

- [x] T028 [US3] Consolidate canonical serialization, corpus, text/cipher, key, and revision helpers beneath `python/src/palimpsest/puzzle/`
- [x] T029 [US3] Point the builder at `fixtures/corpus/` and remove active imports of legacy Python namespaces in `python/src/palimpsest/puzzle/`
- [x] T030 [US3] Delete legacy Python namespaces, root legacy tests, shared legacy test helpers, and unused heavy dependencies from `python/`
- [x] T031 [US3] Delete `packages/contracts`, `packages/git-accounting`, `packages/git-gateway`, `packages/run-control`, Gate/artifact tools, runtime comparison tools, and their tests
- [x] T032 [US3] Delete tracked historical `artifacts/`, specifications 001–005, and the unused Count of Monte Cristo source while preserving `specs/006-behavior-neutral-runner/`
- [x] T033 [US3] Move `tools/evidence/verify-versions.ts` to `tools/verify-versions.ts` and simplify aliases, workspace scripts, ignores, formatting inputs, and active version verification in root configuration
- [x] T034 [US3] Regenerate `pnpm-lock.yaml` and `uv.lock` from the reduced dependency graphs

**Checkpoint**: Only the active TypeScript runner, Python puzzle package, neutral fixtures, current docs, specification 006, and feature 008 remain.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Align current documentation, prove the finished state, and prepare review.

- [x] T035 [P] Update current sandbox, trace, overlap, archive, and plan-pointer decisions in `docs/architecture.md`, `docs/roadmap.md`, `AGENTS.md`, and `CLAUDE.md`
- [x] T036 [P] Verify `docs/proposal.md` needs no semantic change, both guidance files point to feature 008, and `specs/006-behavior-neutral-runner/` remains byte-for-byte equal to `origin/main`
- [x] T037 Run formatting, linting, type checking, TypeScript tests, Python tests, and `git diff --check` through `pnpm verify`
- [x] T038 Build the sandbox and run a fresh `puzzle:offline` fixture following `specs/008-runner-hardening-cleanup/quickstart.md`
- [x] T039 Audit every FR/SC against source, test, and runtime evidence and mark all completed tasks in `specs/008-runner-hardening-cleanup/tasks.md`
- [x] T042 Re-audit current project documentation against the implemented CLI, artifacts, observation fields, evaluation boundary, and verification suite; add a root operator README and repair stale claims
- [ ] T040 Prepare one cleanup pull request mapping the eight audited bot findings to code fixes or deletion, then inspect and address every new review comment before merge
- [ ] T041 After merge, delete only confirmed merged non-006 feature/spec branches and leave every 006-named branch plus `recovery/2026-07-26-combined` untouched

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup establishes the image, fixtures, and test support.
- Foundational defines the sandbox and trace primitives and blocks all stories.
- User Story 1 integrates safe command execution.
- User Story 2 builds on the shared trace and frozen Git outputs.
- User Story 3 runs after active behavior is protected by the new tests.
- Polish and PR review follow all three stories.

### Parallel Opportunities

- T003 and T004 affect independent setup surfaces.
- T010–T012 are separate failing test files.
- T018–T020 cover independent TypeScript/Python observation paths.
- T025 and T026 establish independent active-boundary tests.
- T035 and T036 cover separate documentation/audit work.

## Implementation Strategy

1. Protect current behavior with failing sandbox and trace tests.
2. Complete the P1 command boundary and real containment fixture.
3. Complete chronological tracing and reachable-history observation.
4. Move the active Python dependency closure before deleting any legacy namespace.
5. Remove obsolete code, artifacts, specs, dependencies, and configuration in one greenfield cut.
6. Run fresh repository and Docker-backed end-to-end verification.
7. Open the cleanup PR, read all bot feedback, and only then consider merge and safe remote-branch deletion.

## Notes

- Tests precede their corresponding behavior changes.
- Sandbox failures are infrastructure failures; model-authored command outcomes remain observable.
- No task may add Git metering, accepted-ref policy, publication slots, required files, or workflow gates.
- Preserve all 006-named branches and the entire specification 006 tree.
- Leave the unmerged recovery branch untouched.
