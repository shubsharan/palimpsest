# Phase 0 Research: Puzzle Architecture Refactor

## Current Baseline

- The supplied stable baseline is 43 of 44 TypeScript tests passing, with only the repository-boundary test failing because it reads ignored directories; Python passes 37 of 37 tests.
- A live full TypeScript run reproduced the repository-boundary failure and also encountered one Docker cleanup deadline. The isolated Docker suite immediately passed all 3 tests, so the cleanup result is classified as timing/environmental evidence to retain in verification, not a second settled product defect.
- The current seed-17 deterministic build already records `build-3288b873a2da8ee75f4289f86ccf82c699292d975e263a3a07039cca62e20301`, 48 files, and tree SHA-256 `07500012e6875f444affd0605be0ba818ecd8b35a3560ef12852bdbede8de627`.
- The current run path calls overlap observation before writing `attempt.json`; an overlap failure therefore leaves frozen work without the summary required by evaluation.

## Decision 1: One Root Application

**Decision**: Move the active TypeScript runtime to root `src/`, route all five scripts through one `src/cli.ts`, and delete the private package, barrel, alias, workspace declaration, and package-specific configuration.

**Rationale**: The package and tools are one executable product with one owner and one dependency set. The workspace adds indirection without isolation, reuse, or release value.

**Alternatives considered**:

- Keep `packages/puzzle-runner` and only split large files: rejected because it preserves the unnecessary ownership boundary.
- Introduce `apps/` plus `packages/`: rejected because it adds more hierarchy than the single application needs.
- Keep compatibility aliases: rejected because all imports are private and the feature explicitly chooses a greenfield cut.

## Decision 2: One Dispatcher, Focused Operations

**Decision**: Make `src/cli.ts` responsible only for subcommand selection, argument forwarding, one-line JSON success output, and the existing failure boundary. Keep build, run, evaluation, offline fixture, sandbox preparation, flags, Python bridging, artifact decoding, and overlap in focused modules.

**Rationale**: This retains operator behavior while making every command traceable from one entrypoint to one owner.

**Alternatives considered**:

- Keep five executable files with direct-execution guards: rejected because the requested architecture calls for one dispatcher and the guards duplicate process-boundary behavior.
- Put all five commands in `cli.ts`: rejected because it would recreate the current `tools/puzzle/run.ts` responsibility mix.

## Decision 3: Explicit Variable Capabilities

**Decision**: Rename `AgentAdapter` to `ModelAdapter`, keep provider and deterministic fixture construction outside the contract module, and inject a `MonotonicClock` into reveal scheduling.

**Rationale**: Model access and monotonic time are genuinely variable external capabilities. Explicit boundaries make provider decoding and reveal timing independently testable without a dependency-injection framework.

**Alternatives considered**:

- Retain `AgentAdapter`: rejected because it describes the consumer rather than the external model boundary.
- Stub global timers in tests: rejected because it leaves the scheduler coupled to process globals.
- Add a general service container: rejected as ceremony unsupported by the runtime's size.

## Decision 4: Lifecycle-Only Run Coordinator

**Decision**: Merge the useful functional lifecycle from `runAttempt` and `runPuzzle` into `src/run.ts`, while extracting reveal, provider, fixture, checker, overlap, artifact, Git, session, and sandbox behavior. Delete `Supervisor` and `parseAttemptConfig`.

**Rationale**: One coordinator should make the attempt sequence visible without owning all effects. The class and configuration-string parser have no production caller.

**Alternatives considered**:

- Retain outer and inner coordinators: rejected because they divide one lifecycle without an ownership boundary.
- Replace functions with a larger supervisor class: rejected because it adds state and naming without new behavior.

## Decision 5: Persist Before Optional Observation

**Decision**: Atomically and exclusively write the unchanged `attempt.json` immediately after trace flush and freeze, then begin overlap observation. On observation failure, append `overlap.failed` when possible and rethrow without fabricating `overlap.json` or a success result.

**Rationale**: Freeze completes the model run; overlap is optional post-run observation. Evaluation depends on the summary, not on overlap, so persistence must precede the optional step.

**Alternatives considered**:

- Keep the current order: rejected because completed work becomes hard to inspect and impossible to evaluate through the supported command.
- Swallow overlap failure and return success: rejected because it hides an infrastructure failure.
- Add an attempt-status migration/schema field: rejected because the existing fields are sufficient and artifact compatibility is required.

## Decision 6: Four Sandbox Owners and One Process Primitive

**Decision**: Split sandbox contracts/policy, workspace containment, Docker image/argument construction, and container execution. Introduce one trusted host-process primitive for compatible Git, Python, and Docker lifecycles while keeping domain-specific error classification.

**Rationale**: These are the four independent concerns currently combined in 776 lines. Shared child-process mechanics reduce duplicate cancellation, listener, deadline, and output handling without weakening policy.

**Alternatives considered**:

- Split by arbitrary file size: rejected because it would not clarify ownership.
- Force every subprocess through one success/error abstraction: rejected because Git/Python infrastructure and agent command results have different semantics.
- Keep separate ad hoc spawn implementations: rejected because lifecycle bugs and cleanup behavior would remain duplicated.

## Decision 7: Strict Boundary Decoders

**Decision**: Centralize TypeScript decoders for build, attempt, overlap, and evaluation records and place Python build-manifest decoding with the manifest owner. Reject malformed versions, types, enums, counters, paths, or stage geometry explicitly.

**Rationale**: Current object checks and casts validate only fragments of stored records. Focused decoders make compatibility testable and failures precise without changing valid bytes.

**Alternatives considered**:

- Continue partial checks at each caller: rejected because behavior and error handling drift.
- Add a schema-generation system: rejected because the current records are small and a generator adds infrastructure without experimental value.
- Default missing fields: rejected because it produces success-shaped behavior from corrupted artifacts.

## Decision 8: Direct Python Package with Ownership-Local Types

**Decision**: Move to `python/palimpsest`, retain `puzzle/`, add `evaluation/`, move shared canonical serialization to the package root, and replace generic `model.py` with `puzzle/manifest.py`, `evaluation/score.py`, and `evaluation/overlap.py` ownership.

**Rationale**: Python is a genuine runtime boundary, but the `src/` nesting and mixed model module are not. Ownership-local types prevent construction, scoring, and observation from depending on a generic grab bag.

**Alternatives considered**:

- Retain the Python src layout: rejected as unnecessary nesting for one local distribution.
- Rename `model.py` to `types.py`: rejected because it preserves mixed ownership.
- Add compatibility modules: rejected because the imports and subprocess module paths are private.

## Decision 9: Pure Shard and Transition Geometry

**Decision**: Extract balanced word-boundary splitting, contiguous stream assignment, eligible-symbol intersection, and contradiction metrics into `puzzle/shards.py` with explicit pure inputs.

**Rationale**: These functions define deterministic puzzle geometry but currently sit among corpus reads and artifact writes. Pure extraction allows exact tests at transition stages 2, 4, and 6 without changing build ordering.

**Alternatives considered**:

- Leave private helpers in `build.py`: rejected because construction remains coupled and hard to reason about.
- Create a general domain-model hierarchy: rejected because four pure functions are sufficient.

## Decision 10: Golden Compatibility, Not Full Replay

**Decision**: Capture stable build IDs/tree bytes, checker/scoring aggregates, CLI key sets, session totals, artifact schemas, and trace partial order. Normalize paths, timestamps, image IDs, Git object IDs, Docker duration, and unconstrained event interleaving.

**Rationale**: Golden behavior must protect deterministic mechanics and public contracts without falsely treating concurrent model/Docker/Git timing as reproducible.

**Alternatives considered**:

- Snapshot complete trace bytes: rejected because elapsed time and concurrent ordering legitimately vary.
- Rely only on the existing unit suite: rejected because moves can preserve isolated behavior while changing command/result composition.
- Add a replay system: rejected by the constitution and current experimental need.

## Decision 11: Repository Evidence from Relevant Git Paths

**Decision**: Derive structural assertions from cached plus nonignored untracked paths minus deleted paths, restricted to active scopes.

**Rationale**: Raw directory entries include ignored caches and empty legacy directories; pure `git ls-files` alone is stale during an unstaged move. The combined relevant path set is stable in clean and working checkouts.

**Alternatives considered**:

- Delete caches before every test: rejected because verification would depend on local cleanup.
- Require staging before verification: rejected because normal implementation verification occurs before staging.
- Keep raw `readdir`: rejected because it caused the current known failure.

## Decision 12: Atomic Configuration and Lock Migration

**Decision**: Change TypeScript scripts/includes/formatting inputs, Python package discovery/import roots, private Python module invocations, and lock metadata in the same migration slice. Refresh the Python editable environment after the move.

**Rationale**: Partial migration leaves either the root dispatcher or Python bridge unable to import. The dependency versions do not change; only ownership/import metadata should move.

**Alternatives considered**:

- Keep temporary dual paths: rejected as a compatibility layer and a source of ambiguous ownership.
- Hand-edit generated locks: rejected because the package managers own importer metadata.

## Resolved Clarifications

No unresolved clarification markers remain. The feature description, current constitution, existing contracts, source behavior, and verified baselines fully determine the plan.
