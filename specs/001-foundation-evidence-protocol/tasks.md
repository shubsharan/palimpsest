# Tasks: Foundation and Evidence Protocol

| Field | Value |
| --- | --- |
| Input | Design documents from `specs/001-foundation-evidence-protocol/` |
| Prerequisites | `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |

**Verification**: Tests are mandatory and precede the behavior they govern. Milestone 1 requires TypeScript, Python, cross-language contract, canonicalization, deterministic promotion, failure-mode, isolation-adapter, retry, and clean-checkout verification.

**Organization**: Tasks are grouped by user story and keep schemas, fixtures, and failing tests ahead of implementation.

## Phase 1: Setup

**Purpose**: Establish the pinned two-runtime workspace without creating later-milestone packages.

- [x] T001 Create root pnpm workspace scripts and package policy in `package.json` and `pnpm-workspace.yaml`
- [x] T002 [P] Pin Node, Python, pnpm, uv, and Git in `.node-version`, `.python-version`, and `.tool-versions`
- [x] T003 [P] Configure TypeScript 7, Oxfmt, Oxlint, and Vitest in `tsconfig.json`, `oxfmt.json`, `oxlint.json`, and `vitest.config.ts`
- [x] T004 Create the `@palimpsest/contracts` package boundary in `packages/contracts/package.json` and `packages/contracts/tsconfig.json`
- [x] T005 Create the independent uv Python project and test dependencies in `python/pyproject.toml`
- [x] T006 Extend `.gitignore` with only detected Node, Python, coverage, temporary-attempt, and local artifact patterns in `.gitignore`
- [x] T007 Generate and commit independent exact dependency locks in `pnpm-lock.yaml` and `python/uv.lock`

**Checkpoint**: The repository has one pinned pnpm graph, one independent pinned uv graph, and no domain or agent package.

## Phase 2: Foundational Contracts and Fixtures

**Purpose**: Create the schema authority and frozen inputs that block every user story.

- [x] T008 Define the versioned contract envelope in `packages/contracts/schemas/contract-envelope.schema.json`
- [x] T009 [P] Define canonical JSON and canonical archive input contracts in `packages/contracts/schemas/canonical-json.schema.json` and `packages/contracts/schemas/canonical-archive.schema.json`
- [x] T010 [P] Define the artifact response manifest contract in `packages/contracts/schemas/artifact-response-manifest.schema.json`
- [x] T011 [P] Define the predeclared/completed gate report contract in `packages/contracts/schemas/gate-report.schema.json`
- [x] T012 Build the shared valid and invalid fixture corpus plus expected verdict manifest in `packages/contracts/fixtures/`
- [x] T013 [P] Add TypeScript fixture loading and schema-test helpers in `packages/contracts/tests/helpers.ts`
- [x] T014 [P] Add Python fixture loading and schema-test helpers in `python/tests/helpers.py` and `python/tests/conftest.py`

**Checkpoint**: Schemas and golden fixture expectations exist before runtime behavior.

## Phase 3: User Story 1 - One Contract, Two Runtimes, No Disagreement (Priority: P1)

**Goal**: Both runtimes accept, reject, canonicalize, digest, and archive the same fixture corpus identically.

**Independent Test**: Run the shared fixture corpus through both runtimes and compare normalized verdicts, canonical bytes, archive bytes, and SHA-256 digests.

### Verification for User Story 1

- [x] T015 [P] [US1] Write failing TypeScript validation, RFC 8785, digest, and ustar golden tests in `packages/contracts/tests/contracts.test.ts`
- [x] T016 [P] [US1] Write failing Python validation, RFC 8785, digest, and ustar golden tests in `python/tests/test_contracts.py`
- [x] T017 [US1] Write the failing cross-runtime verdict and byte comparison test in `tests/contract/cross-runtime.test.ts`

### Implementation for User Story 1

- [x] T018 [P] [US1] Implement TypeScript schema registry and normalized validation in `packages/contracts/src/schema-registry.ts` and `packages/contracts/src/validation.ts`
- [x] T019 [P] [US1] Implement Python schema registry and normalized validation in `python/src/palimpsest/contracts/schemas.py` and `python/src/palimpsest/contracts/validation.py`
- [x] T020 [P] [US1] Implement TypeScript strict JSON parsing, RFC 8785 bytes, and SHA-256 in `packages/contracts/src/canonical-json.ts` and `packages/contracts/src/digest.ts`
- [x] T021 [P] [US1] Implement Python strict JSON parsing, RFC 8785 bytes, and SHA-256 in `python/src/palimpsest/contracts/canonical_json.py` and `python/src/palimpsest/contracts/digest.py`
- [x] T022 [P] [US1] Implement canonical TypeScript ustar construction and path rejection in `packages/contracts/src/archive.ts`
- [x] T023 [P] [US1] Implement canonical Python ustar construction and path rejection in `python/src/palimpsest/contracts/archive.py`
- [x] T024 [US1] Export the public TypeScript and Python contract surfaces in `packages/contracts/src/index.ts` and `python/src/palimpsest/contracts/__init__.py`
- [x] T025 [US1] Emit and compare both runtime verdict lists and golden bytes with `tools/evidence/compare-runtimes.ts`

**Checkpoint**: User Story 1 passes independently with zero fixture disagreements.

## Phase 4: User Story 2 - Complete and Provable or Absent (Priority: P2)

**Goal**: A generic producer attempt either atomically promotes a complete digest-bound artifact or records a failure without a success-shaped result.

**Independent Test**: Inject every declared producer and manifest failure, then repeat the honest request twice and compare artifact bytes and digests.

### Verification for User Story 2

- [x] T026 [US2] Write failing subprocess, deadline, stream, manifest, exact-file-set, atomic-promotion, and retry tests in `tests/integration/artifact-promotion.test.ts`
- [x] T027 [P] [US2] Add reference-producer unit tests for honest and injected failure modes in `python/tests/test_reference_producer.py`

### Implementation for User Story 2

- [x] T028 [P] [US2] Implement the domain-free reference producer and canonical NDJSON protocol in `python/src/palimpsest/evidence/reference_producer.py`
- [x] T029 [P] [US2] Define attempt, request, failure, and manifest runner types in `tools/artifact-runner/types.ts`
- [x] T030 [US2] Implement deadline enforcement, canonical NDJSON parsing, and required network-isolation adapters in `tools/artifact-runner/subprocess.ts`
- [x] T031 [US2] Implement exact manifest/file verification, canonical archive creation, failure recording, and atomic promotion in `tools/artifact-runner/promotion.ts`
- [x] T032 [US2] Add the reference-producer runner CLI and all failure injection modes in `tools/artifact-runner/cli.ts`
- [x] T033 [US2] Produce repeated honest-run and failure-mode evidence in `tools/evidence/milestone-report.ts`

**Checkpoint**: Every failure promotes nothing, every attempt is recorded, retry directories are fresh, and repeated honest artifacts are byte-identical.

## Phase 5: User Story 3 - One Command, Clean Checkout, Same Answer (Priority: P3)

**Goal**: One root command verifies both independent ecosystems under the exact supported toolchain.

**Independent Test**: Run `pnpm verify` after frozen dependency synchronization and confirm it fails explicitly for a substituted unsupported version.

### Verification for User Story 3

- [x] T034 [US3] Write failing exact-toolchain and verification-orchestration tests in `tests/integration/verification.test.ts`

### Implementation for User Story 3

- [x] T035 [US3] Implement exact Node, pnpm, Python, uv, and Git checks in `tools/evidence/verify-versions.ts`
- [x] T036 [US3] Wire format, lint, type, TypeScript test, frozen uv test, cross-runtime, and evidence checks into `package.json`
- [x] T037 [US3] Verify lockfile independence and document clean-checkout reproduction in `specs/001-foundation-evidence-protocol/quickstart.md`

**Checkpoint**: `pnpm verify` is the single supported verification entry point and refuses an unpinned environment.

## Phase 6: User Story 4 - A Predeclared Gate Result (Priority: P4)

**Goal**: Gate reports preserve a digest-bound pre-run declaration and can complete only with immutable artifact evidence.

**Independent Test**: Validate predeclared and completed fixtures in both runtimes, then mutate one threshold and one frozen input and confirm both reject completion.

### Verification for User Story 4

- [x] T038 [P] [US4] Write failing TypeScript gate-report state and tamper tests in `packages/contracts/tests/gate-report.test.ts`
- [x] T039 [P] [US4] Write failing Python gate-report state and tamper tests in `python/tests/test_gate_report.py`
- [x] T040 [US4] Extend the cross-runtime test with predeclaration digest and artifact-reference agreement in `tests/contract/cross-runtime.test.ts`

### Implementation for User Story 4

- [x] T041 [P] [US4] Implement TypeScript gate-report projection, completion, and tamper detection in `packages/contracts/src/gate-report.ts`
- [x] T042 [P] [US4] Implement Python gate-report projection, completion, and tamper detection in `python/src/palimpsest/contracts/gate_report.py`
- [x] T043 [US4] Add predeclared, completed, and tampered gate report fixtures in `packages/contracts/fixtures/`
- [x] T044 [US4] Generate and validate the Milestone 1 foundation report in `artifacts/milestone-1/gate-report.json`

**Checkpoint**: Both runtimes reject silent changes to frozen inputs, thresholds, or criteria and resolve all completed report artifacts by digest.

## Phase 7: Polish and Milestone Exit

**Purpose**: Reconcile implementation, evidence, documentation, and milestone status.

- [x] T045 [P] Run schema-reference, fixture-coverage, forbidden-boundary, and generated-artifact consistency checks in `tests/contract/foundation-boundaries.test.ts`
- [x] T046 [P] Update feature and roadmap implementation status with evidence-backed language in `specs/001-foundation-evidence-protocol/spec.md` and `docs/roadmap.md`
- [x] T047 Validate every command in `specs/001-foundation-evidence-protocol/quickstart.md`
- [x] T048 Run `pnpm verify`, `git diff --check`, Markdown structure checks, and inspect the final diff
- [x] T049 Record the Milestone 1 proceed/rework decision and any invalidated downstream evidence in `artifacts/milestone-1/milestone-report.json`

## Dependencies and Execution Order

### Phase Dependencies

- Setup has no implementation dependency.
- Foundational contracts depend on setup and block all user stories.
- User Story 1 depends on foundational schemas and fixtures.
- User Story 2 depends on User Story 1 contract and canonicalization support.
- User Story 3 depends on the verification surfaces implemented by User Stories 1 and 2.
- User Story 4 depends on User Story 1 validation and digest support but remains independently testable.
- Milestone exit depends on all four stories and all declared evidence.

### Parallel Opportunities

- T002 and T003 can proceed independently after T001.
- T009, T010, and T011 affect different schema files after T008.
- T013 and T014 affect separate runtime test helpers after T012.
- Runtime-specific test and implementation pairs marked `[P]` can proceed in parallel, but each failing test must precede its corresponding behavior.
- T038 and T039, then T041 and T042, affect separate runtimes.

## Implementation Strategy

1. Establish exact workspace and contract authority.
2. Deliver User Story 1 as the minimum useful cross-runtime foundation.
3. Add fail-closed artifact production and deterministic promotion.
4. Expose the entire result through one pinned verification command.
5. Add the gate-report lifecycle required before Gates A-D.
6. Produce Milestone 1 evidence and update status only after all checks pass.

## Notes

- Completed tasks must be marked `[x]` in this file.
- Do not add Gate A contracts, corpus code, cipher code, agents, Git metering, run control, grading, or containers.
- Do not describe a fixture or mocked network adapter as production isolation evidence.
- Do not manually wrap prose or add explicit Markdown line-break tags.
