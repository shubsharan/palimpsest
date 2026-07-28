# Tasks: Simple Research Verification

**Input**: Design documents from `specs/012-simple-research-ci/` **Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/research-preflight.md` **Verification**: Fast development checks remain advisory. The feature itself must finish with a real clean-checkout `pnpm preflight`, a matching receipt, focused failure probes, and live branch-protection inspection because it changes the research authorization boundary.

## Phase 1: Setup and Governance

**Purpose**: Establish the new risk-aligned policy and make Feature 012 authoritative before code changes.

- [x] T001 Amend `.specify/memory/constitution.md` to version 4.0.0 and align `.specify/templates/plan-template.md`, `.specify/templates/spec-template.md`, and `.specify/templates/tasks-template.md`
- [x] T002 Complete the Feature 012 specification, checklist, research, plan, data model, contract, and quickstart under `specs/012-simple-research-ci/`
- [x] T003 Point `AGENTS.md` and `CLAUDE.md` at `specs/012-simple-research-ci/plan.md`

**Checkpoint**: Governance, specification, and design agree that CI is advisory and preflight authorizes consequential research.

---

## Phase 2: Foundational Receipt Contract

**Purpose**: Define the one receipt and source/sandbox validation shared by preflight and live runs.

- [x] T004 [P] Add focused receipt decoder, source-state, stale-receipt, sandbox-mismatch, and atomic-publication tests in `src/preflight.test.ts`
- [x] T005 Implement the versioned receipt, clean Git source checks, sandbox identity comparison, canonical path, invalidation, and atomic publication in `src/preflight.ts`

**Checkpoint**: A receipt can exist only for one clean commit and one immutable sandbox identity; malformed, dirty, stale, or mismatched evidence fails explicitly.

---

## Phase 3: User Story 1 - Get Fast Change Feedback (Priority: P1)

**Goal**: Provide visible mechanical Linux feedback for dependencies, source quality, compilation, and the sandbox definition without behavioral suites, a deterministic end-to-end fixture, exact host Git compilation, or a required status gate.

**Independent Test**: Inspect and run the workflow-equivalent commands; they must install locked dependencies, check declarations, formatting and lint, compile TypeScript, and build the sandbox image without running test suites.

### Verification for User Story 1

- [x] T006 [P] [US1] Replace exact host Git/Docker version assertions with mechanical-script and advisory-workflow contract assertions in `tests/integration/verification.test.ts`

### Implementation for User Story 1

- [x] T007 [P] [US1] Remove host Git and Docker patch pins from `.tool-versions` and `tools/verify-versions.ts` while retaining exact Node, pnpm, Python, and uv declarations
- [x] T008 [US1] Add a mechanical `check` while retaining full `test:ts`, `test:py`, and `verify` behavior in `package.json`
- [x] T009 [US1] Simplify `.github/workflows/verify.yml` to advisory pull-request and `main`-push feedback that installs locked dependencies, runs `pnpm check`, and builds the sandbox image
- [x] T010 [US1] Run the workflow-equivalent checks and inspect `.github/workflows/verify.yml` to confirm it contains no test suite, real-container fixture, merge queue, exact Git compilation, or hidden failure mode

**Checkpoint**: CI catches basic mechanical failures and remains visibly advisory.

---

## Phase 4: User Story 2 - Verify Before Spending (Priority: P1)

**Goal**: Expose one fail-closed full preflight that invalidates stale authorization and produces a receipt only after the complete sandbox and deterministic fixture path passes.

**Independent Test**: From a clean checkout, run `pnpm preflight` and inspect the matching canonical receipt; introduce source drift or an injected failure and confirm no receipt survives.

### Verification for User Story 2

- [x] T011 [P] [US2] Add preflight CLI routing plus one-object success, nonzero failure, and no-success-output coverage in `tests/puzzle/cli.test.ts` and the real clean-checkout preflight
- [x] T012 [P] [US2] Add full-sequence success/failure tests for sandbox build, complete verification, fresh scored fixture, final source check, and receipt publication in `src/preflight.test.ts`

### Implementation for User Story 2

- [x] T013 [US2] Implement the ordered sandbox-build, `pnpm verify`, temporary offline fixture, identity confirmation, final source check, and canonical receipt lifecycle in `src/preflight.ts`
- [x] T014 [US2] Route `preflight` through `src/cli.ts` and expose `pnpm preflight` in `package.json`

**Checkpoint**: One explicit command authorizes live research and any failed rerun leaves no authorization.

---

## Phase 5: User Story 3 - Trace Findings to Tested Code (Priority: P2)

**Goal**: Prevent provider calls from stale or missing preflight evidence and retain the exact receipt with every authorized live attempt.

**Independent Test**: Missing, dirty, stale-commit, and sandbox-mismatched cases fail before model sessions; a matching case copies `preflight.json` into the attempt before sessions start and matches `attempt.json.sandbox`.

### Verification for User Story 3

- [x] T015 [P] [US3] Add fixture bypass plus missing, dirty, stale, and sandbox-mismatch live-run authorization tests in `tests/puzzle/cli.test.ts`, `src/run.test.ts`, and `src/preflight.test.ts`
- [x] T016 [P] [US3] Verify live receipt publication ordering and unchanged fixture artifacts in `src/run.test.ts` and `tests/puzzle/offline.test.ts`

### Implementation for User Story 3

- [x] T017 [US3] Validate the current receipt and inspected sandbox before provider-backed model sessions, then copy the receipt into the attempt root in `src/run.ts`

**Checkpoint**: Consequential live runs cannot spend before authorization, and their artifacts retain the tested source/sandbox evidence.

---

## Phase 6: Documentation, External Policy, and Completion

**Purpose**: Reconcile all active guidance, apply the live GitHub policy, and prove the complete feature from authoritative state.

- [x] T018 [P] Update advisory CI, preflight, live operator flow, and publication provenance in `README.md`, `docs/architecture.md`, and `docs/roadmap.md`
- [x] T019 [P] Mark Feature 012 as the active verification authority without rewriting completed Feature 009 implementation history in `README.md` and `specs/009-refactor-puzzle-architecture/quickstart.md`
- [x] T020 Run focused TypeScript/Python tests, `pnpm check`, full `pnpm verify`, formatting, linting, type checking, and `git diff --check`
- [x] T021 Commit the exact feature source, run real clean-checkout `pnpm preflight`, and verify the canonical receipt commit plus sandbox equal the checkout and fresh fixture artifacts
- [x] T022 Remove only the required `verify` status checks from live `main` branch protection, then re-query protection contexts and rulesets to prove zero required status gates remain
- [x] T023 Audit every FR and SC in `specs/012-simple-research-ci/spec.md` against code, tests, the real receipt, workflow content, documentation, and live branch protection; mark all completed tasks

## Dependencies and Execution Order

### Phase Dependencies

- **Setup and Governance (Phase 1)**: Complete before implementation so policy is authoritative.
- **Foundational Receipt (Phase 2)**: Depends on Phase 1 and blocks User Stories 2 and 3.
- **User Story 1 (Phase 3)**: Depends only on Phase 1 and can proceed independently of receipt work.
- **User Story 2 (Phase 4)**: Depends on Phase 2.
- **User Story 3 (Phase 5)**: Depends on User Story 2.
- **Completion (Phase 6)**: Depends on all three user stories.

### Parallel Opportunities

- T004 and T006 can be authored independently.
- T007 and the initial T006 assertions affect separate files.
- T011 and T012 cover separate command and runtime surfaces.
- T015 and T016 cover separate focused and black-box paths.
- T019 and T020 are documentation-only and can proceed alongside focused verification.

## Implementation Strategy

1. Land governance and the strict receipt contract.
2. Deliver the advisory check independently as the first usable increment.
3. Implement preflight using existing full verification and fixture behavior.
4. Gate provider-backed attempts and retain one attempt-bound receipt.
5. Reconcile docs, verify from a clean commit, then change only the live required-status policy.

No test matrix, release environment, generalized attestation, signing, receipt database, compatibility layer, or remote service is part of this feature.
