# Tasks: Puzzle Architecture Refactor

**Input**: Design documents from `/specs/009-refactor-puzzle-architecture/`  
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Verification**: Tests are mandatory for deterministic puzzle mechanics, the five-command operator contract, current-version artifact decoding, trace partial order, sandbox behavior, focused ownership boundaries, overlap-failure durability, and a fresh offline flow.

**Organization**: Tasks are grouped by user story. The stories are independently testable, while the greenfield source move is deliberately sequenced before responsibility extraction so no compatibility facade or temporary dual command path is needed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes different files and has no unmet dependency.
- **[Story]**: Maps the task to a user story in `spec.md`.
- Every task names the exact file or directory it changes or verifies.

---

## Phase 1: Setup (Migration Guardrails)

**Purpose**: Capture only the protected scientific, command, historical, and user-owned inputs before relocating active code.

- [x] T001 Record the fixed seed-17 and seed-0 scientific values, normalized minimum CLI results, and contractual trace partial-order assertions from `specs/009-refactor-puzzle-architecture/contracts/behavior-baseline.md` in `tests/golden/behavior.json`
- [x] T002 Capture pre-migration digests for `specs/006-behavior-neutral-runner/`, `specs/008-runner-hardening-cleanup/`, `docs/proposal.md`, and the existing `.artifacts-tmp/gate-b-contract-cases.json`, record the values beside T002 in `specs/009-refactor-puzzle-architecture/tasks.md`, and do not modify, stage, move, or archive the protected paths
  - Pre-migration evidence: Git tree `specs/006-behavior-neutral-runner/` = `fd426ed76cf31b1abd428a7c8f5b4c1dbf9cd9b7`; Git tree `specs/008-runner-hardening-cleanup/` = `3ad167d12a3d8d82d8c33e3e295e49919a9c053b`; Git blob `docs/proposal.md` = `7e0278e3d479c5bfdffdecc575259b43b7afa882`; SHA-256 `.artifacts-tmp/gate-b-contract-cases.json` = `b8ff040e34b865b9749dd545a83dbaf3f2dfcbb8245dddd0fe6e93c03f278c04`.

**Checkpoint**: The narrow behavior baseline and preservation boundaries are recorded before any source path changes.

---

## Phase 2: Foundational (Pre-Move Baseline Gate)

**Purpose**: Prove the captured expectations against the current implementation before changing source discovery or command paths.

- [x] T003 Run the pre-move TypeScript suite from `package.json`, confirm the stable 43-of-44 baseline and isolated Docker rerun described in `specs/009-refactor-puzzle-architecture/contracts/behavior-baseline.md`, and record the results beside T003 in `specs/009-refactor-puzzle-architecture/tasks.md`
  - Pre-move evidence (2026-07-27): after rebuilding the sandbox with system-level Git trust for the host-UID bind roots and running through the pinned Docker 29.2.1 client, the full suite reported 42/44: the expected repository-boundary defect plus the documented full-suite cancellation/cleanup timing blip. The immediate isolated Docker rerun passed 3/3, and the focused sandbox unit suite passed 5/5. No active source path had moved.
- [x] T004 Run the pre-move Python suite configured by `python/pyproject.toml`, confirm all 37 deterministic cases pass, and record the result beside T004 in `specs/009-refactor-puzzle-architecture/tasks.md`
  - Pre-move evidence (2026-07-27): `uv run --offline --locked pytest` from `python/` collected 37 tests and passed 37/37 with Python 3.12.4 and pytest 9.1.1.
- [x] T005 Execute the pre-move seed-17 build and seed-0 offline fixture through the scripts in `package.json` and confirm `tests/golden/behavior.json` contains every declared stable value and none of the deliberately non-golden values
  - Pre-move evidence (2026-07-27): the seed-17 build reproduced `build-3288b873a2da8ee75f4289f86ccf82c699292d975e263a3a07039cca62e20301` with 3 agents, 6 stages, and transition stage 4. A fresh seed-0 offline run reproduced `build-ae72df272e36e174166945c67429f6ecfaf510a07f9be8821d044a26dc171dd1`, token totals 5/4, 13/11, and 4/3, the 9/3/3/3 overlap scan with no findings, score 0/27504 with coverage 1 and accuracy 0, and every declared trace partial order. `tests/golden/behavior.json` contains the declared scientific/minimum-command values and explicitly excludes all deliberately non-golden categories.

**Checkpoint**: The current implementation satisfies the narrow scientific/command baseline, apart from the already classified repository-boundary defect.

---

## Phase 3: User Story 1 - Operate the Same Puzzle After the Refactor (Priority: P1) MVP

**Goal**: Preserve the five operator commands, agent-visible experiment, deterministic mechanics, sandbox policy, and fresh current-version build-run-evaluate flow after the clean source move.

**Independent Test**: Run the five command contracts and a fixed offline build, three-agent run, overlap observation, evaluation, and score; compare the scientific values and required trace relationships in `tests/golden/behavior.json`.

### Verification for User Story 1

> Write these assertions before the relocation and confirm they protect behavior rather than exact private representations.

- [x] T006 [P] [US1] Extend all five command contract cases for names, accepted flags, defaults, required relationships, absolute paths, minimum success fields, allowed extra fields, one-object stdout, and nonzero stderr failures in `tests/puzzle/cli.test.ts`
- [x] T007 [P] [US1] Add fixed-seed build identity, checker aggregate, reconstruction score, session totals, and trace partial-order golden assertions without exact event interleaving or exact JSON key equality in `tests/puzzle/offline.test.ts`
- [x] T008 [P] [US1] Reorganize deterministic build, geometry, checker, overlap, and scoring regressions at `python/tests/puzzle/` and `python/tests/evaluation/` against the values in `tests/golden/behavior.json`
- [x] T009 [P] [US1] Retain real-container identity, mounts, environment, resource limits, path containment, timeout, cancellation, output overflow, cleanup, and evaluation-image mismatch coverage in `tests/puzzle/sandbox.integration.test.ts`

### Implementation for User Story 1

- [x] T010 [US1] Relocate the TypeScript runtime and colocated Vitest inputs from `packages/puzzle-runner/` into the planned root modules under `src/`, preserving prompt text, tools, session outcomes, voluntary Git behavior, checker disclosure, trace semantics, and sandbox request/result contracts
- [x] T011 [US1] Consolidate `tools/puzzle/` into `src/cli.ts`, `src/flags.ts`, `src/build.ts`, `src/run.ts`, `src/evaluate.ts`, `src/offline.ts`, and `src/python.ts`, then atomically switch all five scripts and TypeScript/Vitest/lint/format discovery in `package.json`, `tsconfig.json`, `vitest.config.ts`, `oxlint.json`, and `oxfmt.json`
- [x] T012 [US1] Delete `packages/puzzle-runner/package.json`, `packages/puzzle-runner/tsconfig.json`, `pnpm-workspace.yaml`, the `@palimpsest/puzzle-runner` alias, and the obsolete workspace importer in `pnpm-lock.yaml` in the same slice that makes the root application test-discoverable
- [x] T013 [US1] Move `python/src/palimpsest` to `python/palimpsest`, move checker/overlap/score modules and tests into `python/palimpsest/evaluation/` and `python/tests/evaluation/`, update package discovery and pytest/Ruff roots in `python/pyproject.toml`, update TypeScript module invocations in `src/python.ts`, and regenerate `python/uv.lock` without changing dependency versions
- [x] T014 [US1] Centralize strict current-version build, attempt, overlap, and evaluation readers in `src/artifacts.ts`, wire them through `src/build.ts`, `src/run.ts`, `src/evaluate.ts`, and `src/offline.ts`, and verify a fresh artifact chain is consumed only by those readers
- [x] T015 [US1] Run `tests/puzzle/cli.test.ts`, `tests/puzzle/offline.test.ts`, `tests/puzzle/sandbox.integration.test.ts`, `python/tests/puzzle/`, and `python/tests/evaluation/` and reconcile every result with `tests/golden/behavior.json`
  - Post-move checkpoint (2026-07-27): the three focused TypeScript/Docker files passed 17/17 and the reorganized Python ownership suites passed 37/37. Fixed-seed identities, aggregate checker/scoring values, token totals, overlap counts, trace relationships, sandbox contracts, command boundaries, and minimum extensible results match `tests/golden/behavior.json`.

**Checkpoint**: The root commands operate the same puzzle with the declared minimum results, and no operator workflow depends on the deleted command or package paths.

---

## Phase 4: User Story 2 - Maintain One Compact Active Architecture (Priority: P2)

**Goal**: Give every active TypeScript and Python responsibility one clear owner while keeping the dispatcher and run coordinator lifecycle-only.

**Independent Test**: Inspect active Git-relevant paths and focused unit tests to confirm one root application, one Python distribution, no deleted-layout facade, and no mixed owner named by the architecture contract.

### Verification for User Story 2

- [x] T016 [P] [US2] Add active-layout assertions for one root application, one Python distribution, no workspace/alias/barrel/compatibility facade, and no references to deleted paths or names in `tests/integration/verification.test.ts`
- [x] T017 [P] [US2] Add focused provider decoding, exhaustive fixture-scenario, session lifecycle, and clock-controlled reveal tests in `src/provider.test.ts`, `src/fixture.test.ts`, `src/session.test.ts`, and `src/reveal.test.ts`
- [x] T018 [P] [US2] Move and extend focused activity, Git, overlap, trace, prompt, and tool tests in `src/activity.test.ts`, `src/git.test.ts`, `src/overlap.test.ts`, `src/trace.test.ts`, `src/prompt.test.ts`, and `src/tools.test.ts`
- [x] T019 [P] [US2] Add trusted-process lifecycle coverage in `src/process.test.ts` and split sandbox coverage among path containment, image/argument construction, and container lifecycle owners in `src/sandbox/workspace.test.ts`, `src/sandbox/docker.test.ts`, and `src/sandbox/container.test.ts`
- [x] T020 [P] [US2] Add pure manifest and shard/transition geometry tests plus evaluation-owner tests in `python/tests/puzzle/test_manifest.py`, `python/tests/puzzle/test_shards.py`, and `python/tests/evaluation/`

### Implementation for User Story 2

- [x] T021 [US2] Make `src/cli.ts` a dispatcher only and make `src/run.ts` lifecycle-only by moving stored-record, checker, overlap, Git, trace, prompt, and tool behavior to `src/artifacts.ts`, `src/checker.ts`, `src/overlap.ts`, `src/git.ts`, `src/trace.ts`, `src/prompt.ts`, and `src/tools.ts`
- [x] T022 [US2] Replace `AgentAdapter` with the single `ModelAdapter` contract in `src/model.ts`, move live OpenAI construction/decoding to `src/provider.ts`, move deterministic `collaborative-revision` behavior to `src/fixture.ts`, and inject one `MonotonicClock` from `src/reveal.ts` through `src/run.ts`
- [x] T023 [US2] Implement the explicit-environment, deadline/abort, process-group, listener-cleanup, and byte-limit primitive in `src/process.ts`, then split sandbox contracts/policy, workspace validation, Docker identity/arguments, and execution/cleanup into `src/sandbox/contracts.ts`, `src/sandbox/workspace.ts`, `src/sandbox/docker.ts`, and `src/sandbox/container.ts` without changing domain error classification
- [x] T024 [US2] Replace the mixed Python model with manifest-owned build/stage records in `python/palimpsest/puzzle/manifest.py`, pure geometry in `python/palimpsest/puzzle/shards.py`, score/overlap types beside `python/palimpsest/evaluation/score.py` and `python/palimpsest/evaluation/overlap.py`, and canonical JSON only in `python/palimpsest/serialization.py`
- [x] T025 [US2] Delete the unused `Supervisor`, `parseAttemptConfig`, deprecated adapter names, forwarding wrappers, package barrel, and residual deleted-layout imports from `src/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `python/pyproject.toml`, `pnpm-lock.yaml`, and `python/uv.lock`
- [x] T026 [US2] Run the colocated TypeScript suite under `src/`, the reorganized Python suite under `python/tests/`, and the active-layout assertions in `tests/integration/verification.test.ts`

**Checkpoint**: Maintainers can trace each command and runtime concern to one owner, with no compatibility-only surface.

---

## Phase 5: User Story 3 - Retain a Durable Attempt When Observation Fails (Priority: P3)

**Goal**: Publish a complete frozen attempt before optional overlap observation and keep it evaluatable when observation fails.

**Independent Test**: Inject attempt-write, overlap, and diagnostic-append failures; verify publication ordering, primary-error behavior, artifact absence/presence, and evaluation from the saved attempt without rerunning agents.

### Verification for User Story 3

- [x] T027 [P] [US3] Add strict malformed build, attempt, overlap, trace, and evaluation decoder cases for invalid JSON, versions, types, enums, counters, paths, sandbox identity, and stage geometry in `src/artifacts.test.ts` and `src/trace.test.ts`
- [x] T028 [US3] Add post-freeze overlap-failure coverage proving nonzero stderr, no success stdout, readable `attempt.json`, intact trace/frozen inputs, no fabricated `overlap.json`, no failure sidecar, and successful later evaluation in `tests/puzzle/attempt-durability.test.ts`
- [x] T029 [US3] Extend `tests/puzzle/attempt-durability.test.ts` with an attempt-write failure that never starts overlap or exposes a partial summary and a diagnostic-append failure that leaves the original overlap error primary

### Implementation for User Story 3

- [x] T030 [US3] Implement complete same-directory temporary summary writing and atomic rename inside the exclusively created attempt root in `src/artifacts.ts`, without locks, hard-link publication, retries for concurrent writers, or migration machinery
- [x] T031 [US3] Reorder `src/run.ts` to end sessions, flush trace, freeze Git/workspaces, publish `attempt.json`, then observe overlap; on observation failure append `overlap.failed` best-effort and rethrow the original error without success JSON or `overlap.json`
- [x] T032 [US3] Allow `src/evaluate.ts` to evaluate every strictly decoded summarized attempt regardless of overlap presence while preserving selection-before-execution and status-specific score/error results
- [x] T033 [US3] Run `src/artifacts.test.ts`, `src/trace.test.ts`, and `tests/puzzle/attempt-durability.test.ts` and inspect the injected failure directories to confirm no partial summary or invented diagnostic artifact is visible

**Checkpoint**: A frozen run survives optional observation failure as a strict, readable, evaluatable current-version attempt.

---

## Phase 6: User Story 4 - Verify the Refactor Independent of Local Caches (Priority: P4)

**Goal**: Make structural and end-to-end verification depend on active tracked/nonignored paths and fresh artifacts rather than local caches or historical fixtures.

**Independent Test**: Run boundary verification with ignored caches present and absent, reject an unknown fixture scenario before attempt side effects, and complete a fresh offline fixture using only active readers.

### Verification for User Story 4

- [x] T034 [P] [US4] Derive active repository paths from cached plus nonignored untracked paths minus deleted paths and add ignored-cache, empty-directory, and unstaged-move cases in `tests/integration/verification.test.ts`
- [x] T035 [P] [US4] Add explicit `collaborative-revision` default/selection and unknown-scenario-before-side-effects cases in `src/fixture.test.ts` and `tests/puzzle/cli.test.ts`
- [x] T036 [P] [US4] Add a fresh build-run-overlap-evaluate decoder-chain assertion and minimum nested offline result checks in `tests/puzzle/offline.test.ts`

### Implementation for User Story 4

- [x] T037 [US4] Restrict `tests/integration/verification.test.ts` to current active scopes while excluding historical specifications from deleted-name assertions and proving ignored caches cannot change the result
- [x] T038 [US4] Ensure `package.json`, `tsconfig.json`, `vitest.config.ts`, `oxlint.json`, `oxfmt.json`, and `python/pyproject.toml` discover every relocated source/test path and no deleted path, while retaining `tools/verify-versions.ts`
- [x] T039 [US4] Run boundary verification twice with representative ignored caches present and absent, then run the unknown fixture failure and fresh offline flow from `specs/009-refactor-puzzle-architecture/quickstart.md`

**Checkpoint**: Verification reports the active repository and fresh workflow identically in clean and previously used checkouts.

---

## Phase 7: Polish & Cross-Cutting Acceptance

**Purpose**: Align current documentation, remove only proven-obsolete material, and verify the complete greenfield cut.

- [x] T040 [P] Update the active root layout, command dispatcher, runtime ownership, artifact durability, current-version boundary, and verification commands in `README.md`, `docs/architecture.md`, `docs/roadmap.md`, `AGENTS.md`, and `CLAUDE.md`
- [x] T041 [P] Verify `docs/proposal.md` remains semantically unchanged, `specs/006-behavior-neutral-runner/` and `specs/008-runner-hardening-cleanup/` retain their pre-migration digests, and `.artifacts-tmp/gate-b-contract-cases.json` retains its pre-migration byte hash
- [x] T042 Remove only confirmed generated caches and empty legacy directories under `packages/puzzle-runner/`, `tools/puzzle/`, and `python/src/` after `tests/integration/verification.test.ts` proves no tracked or active source depends on them
- [x] T043 Build the current sandbox image, run focused TypeScript/Python/Docker suites, and confirm its returned identity fields and immutable ID through `containers/puzzle-sandbox/Dockerfile` and `tests/puzzle/sandbox.integration.test.ts`
- [x] T044 Run `pnpm verify` and `git diff --check`, then audit `src/`, `python/palimpsest/`, `tests/`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `oxlint.json`, `oxfmt.json`, `pnpm-lock.yaml`, and `python/uv.lock` for deleted paths/names, compatibility aliases, migrations, replay paths, and exact-key assertions
- [x] T045 Execute a new `puzzle:offline` output using `specs/009-refactor-puzzle-architecture/quickstart.md`, decode every build/attempt/overlap/evaluation artifact through the active implementation, and compare only `tests/golden/behavior.json` scientific and minimum-CLI guarantees
- [x] T046 Audit every FR and SC in `specs/009-refactor-puzzle-architecture/spec.md` against source, focused tests, full verification, and the fresh offline artifacts, then mark completed tasks in `specs/009-refactor-puzzle-architecture/tasks.md`

---

## Phase 8: Post-Implementation Repository Cleanup

**Purpose**: Leave only the active specification, runtime, tests, fixtures, documentation, and tool integrations in the working tree.

- [x] T047 Remove superseded specifications 006 and 008, `.artifacts-tmp`, ignored Gate/harness/replay output, obsolete package roots, generated caches, and unused Cursor state after confirming none are active runtime inputs
- [x] T048 Recreate `python/.venv` from the frozen current lock so obsolete legacy dependencies are absent
- [x] T049 Refresh `.gitignore`, align Feature 009 and current documentation with the clean-tree policy, run full verification, and audit the final tree for legacy folders and references

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** starts immediately and must finish before any active source moves.
- **Phase 2** depends on Phase 1 and proves the current implementation against the captured baseline before any source move.
- **User Story 1 (Phase 3)** depends on Phases 1-2 and performs the behavior-protected clean relocation.
- **User Story 2 (Phase 4)** depends on the relocated root application from User Story 1.
- **User Story 3 (Phase 5)** depends on User Story 1; it may proceed in parallel with User Story 2 after the root cut because its durable writer and lifecycle changes have separate acceptance tests.
- **User Story 4 (Phase 6)** depends on User Story 1 and consumes the final User Story 2/3 layout and behavior for full verification.
- **Polish (Phase 7)** depends on all four stories.
- **Post-implementation cleanup (Phase 8)** depends on completed acceptance and removes material that the active implementation no longer consumes.

### Critical Task Dependencies

- T003-T005 depend on T001-T002 and must finish before source discovery changes.
- T010-T014 depend on T001-T009; T011-T013 form one migration slice and are not a supported partial checkout.
- T015 depends on T006-T014 and is the User Story 1 gate.
- T021-T025 depend on the focused tests in T016-T020.
- T026 depends on T021-T025 and is the User Story 2 gate.
- T030-T032 depend on T027-T029.
- T033 depends on T030-T032 and is the User Story 3 gate.
- T037-T038 depend on T034-T036.
- T039 depends on T037-T038 and is the User Story 4 gate.
- T042 depends on T037, T038, and the preservation check in T041.
- T043-T046 run sequentially after implementation and documentation are complete.

### Parallel Opportunities

- T006-T009 cover independent TypeScript, Python, and Docker test surfaces.
- T016-T020 cover independent architecture owners.
- T027 can run in parallel with the durability test preparation in T028; T029 follows T028 because both edit the same file.
- T034-T036 cover independent repository, fixture/CLI, and offline verification surfaces.
- T040 and T041 affect current documentation and preservation evidence independently.

---

## Parallel Example: User Story 1

```text
Task T006: Extend command contracts in tests/puzzle/cli.test.ts
Task T007: Add scientific and trace goldens in tests/puzzle/offline.test.ts
Task T008: Reorganize deterministic Python regressions in python/tests/
Task T009: Retain Docker-backed sandbox coverage in tests/puzzle/sandbox.integration.test.ts
```

## Parallel Example: User Story 2

```text
Task T017: Test model/provider/fixture/session/reveal owners in src/
Task T018: Test activity/Git/overlap/trace/prompt/tool owners in src/
Task T019: Test sandbox owners in src/sandbox/
Task T020: Test Python manifest/shards/evaluation owners in python/tests/
```

## Parallel Example: User Story 3

```text
Task T027: Add strict decoder and trace validation cases in src/
Task T028: Add the post-freeze overlap failure journey in tests/puzzle/attempt-durability.test.ts
```

## Parallel Example: User Story 4

```text
Task T034: Add Git-relevant path and ignored-cache cases in tests/integration/verification.test.ts
Task T035: Add fixture scenario contract cases in src/fixture.test.ts and tests/puzzle/cli.test.ts
Task T036: Add the fresh current-version decoder chain in tests/puzzle/offline.test.ts
```

---

## Implementation Strategy

### MVP First

1. Complete migration guardrails and the shared process primitive.
2. Write the User Story 1 contract and scientific assertions before moving code.
3. Perform the TypeScript and Python moves with their discovery/configuration/lock metadata.
4. Stop after T015 and verify the operator can run the unchanged experiment from the root application.

### Incremental Delivery

1. **User Story 1**: Preserve the working operator/scientific path through the clean cut.
2. **User Story 2**: Finish the focused ownership boundaries and delete obsolete internal surfaces.
3. **User Story 3**: Publish the frozen attempt before optional observation and prove failure durability.
4. **User Story 4**: Make repository and fresh-flow verification independent of caches.
5. **Polish**: Align current documentation, remove only proven generated residue, and run fresh acceptance.

### Greenfield Constraints

- Do not add compatibility aliases, historical artifact fixtures, schema generators, replay support, dual command paths, migration readers, failure sidecars, or concurrent-writer coordination.
- Reuse current artifact shapes only when they remain the shortest adequate active design.
- Preserve command names, flags, defaults, minimum results, deterministic puzzle mechanics, sandbox behavior, trace partial order, agent-visible tools, and voluntary Git.
- Keep `docs/proposal.md` semantically unchanged; Git history is the archive for removed superseded specifications and evidence.

## Notes

- Scientific and CLI regression cases are expected to pass before and after the move; newly introduced boundary and durability cases must fail before their implementation tasks.
- Tests compare contractual values rather than complete stored representations.
- `[P]` means the listed files do not overlap and the task has no unmet dependency.
- The TypeScript and Python moves include their runtime scripts, discovery inputs, and lock metadata so each relocated baseline becomes testable without a transitional command path.
- Each story checkpoint is independently demonstrable even though the architectural stories build on the single greenfield relocation.
