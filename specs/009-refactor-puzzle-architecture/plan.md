# Implementation Plan: Puzzle Architecture Refactor

**Branch**: `009-refactor-puzzle-architecture` | **Date**: 2026-07-27 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/009-refactor-puzzle-architecture/spec.md`

## Summary

Collapse the active TypeScript runner and its operator scripts into one root application under `src/`, retain one independently packaged Python distribution under `python/palimpsest`, and remove the private single-package workspace without a compatibility facade. Split the two oversized runtime files by real responsibility, rename the model boundary to `ModelAdapter`, inject a `MonotonicClock`, and persist `attempt.json` immediately after freeze before optional overlap observation. Preserve agent-visible puzzle behavior, the five command names and their flags/defaults, minimum useful command results, deterministic mechanics, Docker policy, error classification, and voluntary unmetered Git semantics. Treat private imports, exact JSON key sets, and records from earlier implementations as greenfield details with no migration path.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: Node standard library and built-in `fetch`, Docker 29.2.1 CLI/engine, Git 2.48.1, `rfc8785` 0.1.4 **Storage**: Local corpus fixtures, generated build and attempt directories, JSON/JSONL records, an ordinary bare Git repository, frozen workspaces, and independent JavaScript/Python lockfiles **Testing**: Vitest 4.1.10, pytest 9.1.1, Ruff 0.16.0, Oxlint 1.75.0, Oxfmt 0.60.0, real Git/Docker integration tests, and a fresh offline fixture **Target Platform**: macOS or Linux host with Docker Engine/Desktop; Linux command containers **Project Type**: Local dual-runtime CLI with one root TypeScript application and one Python distribution **Performance Goals**: Preserve configured stage offsets, global wall time, per-agent token limits, command timeouts, the 4 MiB output limit, and current offline-fixture completion characteristics **Constraints**: No public network or undeclared mounts in command containers; 2 CPUs, 2 GiB memory, 256 PIDs, 256 MiB temporary storage; no compatibility layer for deleted private imports or earlier stored records; preserve command names, flags/defaults, minimum results, one-object success output, and nonzero standard-error failure behavior rather than exact JSON key sets **Scale/Scope**: Five operator commands, three persistent agents, six stages per agent, one shared bare Git repository, 44 TypeScript tests, 37 Python tests, and one fresh build-run-overlap-evaluate-score acceptance path **Puzzle Contribution**: No new agent-visible behavior; the refactor makes the existing behavior-neutral puzzle shorter to maintain and makes a frozen attempt durable when optional observation fails **Agent Instructions & Tools**: Preserve the shared objective, peer context, `run_command`, `check_reconstruction`, `wait_for_activity`, ordinary Git, and the requested but unenforced preference for compact findings over raw evidence **Environmental Constraints**: Preserve private staged evidence, one monotonic reveal schedule, wall-time/token cutoffs, sandbox mount identities, network denial, secret isolation, immutable image validation, and host-safety limits **Observable Outcomes**: Preserve model turns, tool activity, session lifecycle, stage releases, checker aggregates, Git behavior, trace chronology, frozen work, raw overlap, reviewer selection, execution result, reconstruction score, unusual behavior, and resource termination **Determinism Claim**: Fixed inputs reproduce puzzle construction, transition/shard geometry, release order, checker aggregates, overlap rules, contractual trace relationships, and scoring; model decisions, unconstrained Git/agent event interleaving, wall-clock duration, Docker timing, and reviewer judgment remain nondeterministic

## Constitution Check

_GATE: Passed before Phase 0 research and passed again after Phase 1 design._

- **Puzzle behavior before process — PASS**: Prompt text, available tools, puzzle objective, and agent autonomy remain unchanged. The design adds no algorithm, role, turn, checkpoint, branch, or intermediate artifact requirement.
- **Environmental constraints, not workflow — PASS**: The same evidence schedule, resource cutoffs, mounts, and sandbox policy remain independent of model behavior. `MonotonicClock` makes the existing schedule testable without changing it.
- **Minimal reproducible mechanics — PASS**: The design removes a workspace, a barrel, an unused class, an unused parser, mixed model types, and duplicate process logic. New boundaries correspond only to current runtime responsibilities and do not add services, schema migrations, historical fixture matrices, replay, or promotion machinery.
- **Observe outcomes honestly — PASS**: Failed overlap observation is reported as infrastructure failure while the completed model run remains frozen and evaluatable. Incorrect solutions, raw sharing, no Git, repeated checking, and unconventional work remain ordinary observations.
- **Voluntary native collaboration — PASS**: Ordinary Git remains the supplied peer channel and stays voluntary and unmetered. The refactor does not inspect, reject, repair, or prescribe collaboration.

## Project Structure

### Documentation (this feature)

```text
specs/009-refactor-puzzle-architecture/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── attempt-artifacts.md
│   ├── behavior-baseline.md
│   ├── command-sandbox.md
│   └── operator-cli.md
├── checklists/
│   └── requirements.md
└── tasks.md                 # Created later by /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── cli.ts
├── flags.ts
├── build.ts
├── run.ts
├── run.test.ts
├── evaluate.ts
├── evaluate.test.ts
├── offline.ts
├── artifacts.ts
├── artifacts.test.ts
├── python.ts
├── process.ts
├── process.test.ts
├── model.ts
├── provider.ts
├── provider.test.ts
├── fixture.ts
├── fixture.test.ts
├── session.ts
├── session.test.ts
├── reveal.ts
├── reveal.test.ts
├── activity.ts
├── activity.test.ts
├── git.ts
├── git.test.ts
├── overlap.ts
├── overlap.test.ts
├── checker.ts
├── trace.ts
├── trace.test.ts
├── prompt.ts
├── prompt.test.ts
├── tools.ts
├── tools.test.ts
└── sandbox/
    ├── contracts.ts
    ├── workspace.ts
    ├── workspace.test.ts
    ├── docker.ts
    ├── docker.test.ts
    ├── container.ts
    └── container.test.ts

python/
├── pyproject.toml
├── uv.lock
├── palimpsest/
│   ├── __init__.py
│   ├── serialization.py
│   ├── puzzle/
│   │   ├── __init__.py
│   │   ├── build.py
│   │   ├── cipher.py
│   │   ├── corpus.py
│   │   ├── manifest.py
│   │   ├── revision.py
│   │   ├── shards.py
│   │   └── text.py
│   └── evaluation/
│       ├── __init__.py
│       ├── checker.py
│       ├── overlap.py
│       └── score.py
└── tests/
    ├── puzzle/
    │   ├── test_build.py
    │   ├── test_manifest.py
    │   ├── test_primitives.py
    │   └── test_shards.py
    └── evaluation/
        ├── test_checker.py
        ├── test_overlap.py
        └── test_score.py

tests/
├── golden/
│   └── behavior.json
├── puzzle/
│   ├── cli.test.ts
│   ├── offline.test.ts
│   ├── attempt-durability.test.ts
│   └── sandbox.integration.test.ts
└── integration/
    └── verification.test.ts

tools/
└── verify-versions.ts

containers/
└── puzzle-sandbox/
    └── Dockerfile

fixtures/
└── corpus/
```

**Structure Decision**: Use one flat root application because all TypeScript code ships and runs as one operator program. Keep only `src/sandbox/` as a nested subsystem because it has a distinct contract, validation policy, Docker argument builder, and container lifecycle. Keep the Python project because deterministic construction/evaluation is a real cross-runtime ownership boundary, but remove its unnecessary `src/` nesting and split construction from evaluation. Unit tests live beside TypeScript modules and by Python subpackage; black-box command, Docker, and repository checks remain under root `tests/`.

## Design

### Root Operator Application

`src/cli.ts` is the sole executable dispatcher. Each existing package script invokes it with one internal subcommand: `sandbox-build`, `build`, `run`, `evaluate`, or `offline`. The dispatcher selects an operation, passes the remaining arguments to the unchanged strict flag parser, writes exactly one JSON line on success, and lets failures reject to the existing nonzero/stderr boundary. It does not contain puzzle, provider, fixture, evaluation, or sandbox behavior.

The active command contract requires `sandbox-build` to return `imageTag`, `imageId`, `sourceDigest`, and `profileVersion`; `build` to return `buildId` and an absolute `buildPath`; `run` to return `attemptId` and an absolute `attemptRoot`; `evaluate` to return its status plus a score or error when that status requires one; and `offline` to return the corresponding minimum build, run, and evaluation results. Commands may return additional fields, but exact key equality is not a compatibility requirement.

The former `@palimpsest/puzzle-runner` sources move directly into `src/`. There is no root barrel and no compatibility alias. The private package manifest, package TypeScript configuration, `pnpm-workspace.yaml`, and lockfile workspace importer are deleted. `tools/verify-versions.ts` remains the only development utility outside `src/`.

### Model, Session, and Reveal Boundaries

`src/model.ts` owns `ModelAdapter`, `ModelSession`, request/turn/tool-call, and token-usage contracts. `src/provider.ts` owns OpenAI client construction and response decoding. `src/fixture.ts` owns deterministic fixture scripts and an exhaustive `FixtureScenario` decoder whose only supported value is `collaborative-revision`.

`src/session.ts` retains the persistent model/tool loop and session termination semantics. `src/reveal.ts` owns stage scheduling and receives a `MonotonicClock`; the production implementation delegates to `performance.now()` and timers, while focused tests control both elapsed time and waits. `src/run.ts` passes the same clock-derived elapsed-time source to reveal, activity, and trace wiring, then limits itself to configuration, lifecycle composition, concurrent sessions, freeze, summary persistence, and optional observation.

The unused `Supervisor` wrapper and `parseAttemptConfig(string)` are deleted. No deprecated names or forwarding wrappers remain.

### Run Durability and Artifact Decoding

The successful run lifecycle is:

1. Decode the build manifest and command options.
2. Validate the fixture scenario or construct the live provider.
3. Run sessions, flush the trace, and freeze Git/workspaces.
4. Completely write a temporary summary in the attempt directory and atomically rename it to `attempt.json`.
5. Run overlap collection, write `overlap.json`, and append `overlap.observed`.
6. Return a success result containing at least `attemptId` and the absolute `attemptRoot`.

The run owns an attempt root that was created exclusively before work began; concurrent writers are outside the supported model. If attempt-summary persistence fails, observation does not start and no partial `attempt.json` becomes visible. If overlap observation fails after summary persistence, the run command remains nonzero, reports the original failure through standard error, and emits no success object or fabricated `overlap.json`. It appends `overlap.failed` when the trace remains writable, but a diagnostic-append failure never replaces the original failure. `attempt.json`, the trace, frozen Git, and workspaces remain available to `puzzle:evaluate`; no additional failure sidecar is created.

`src/artifacts.ts` owns strict, named decoders and encoders for build results/manifests, attempt summaries, overlap results, and evaluation records. It validates schema versions, required fields, arrays, counters, agent IDs, statuses, path strings, sandbox identity, and stage cardinality. The active build-run-evaluate flow must consume every record it produces, while malformed current-version records fail without partial casts or silent defaults. Existing shapes may remain where they are already simplest, but records from earlier implementations, migrations, and compatibility wrappers are unsupported.

### Sandbox Subsystem and Trusted Processes

The current sandbox file separates into:

- `sandbox/contracts.ts`: unchanged `CommandSandbox`, request, result, identity, policy, mount constants, and error shapes.
- `sandbox/workspace.ts`: relative-path validation, containment, regular-file checks, symlink resolution, and evaluator output validation.
- `sandbox/docker.ts`: Dockerfile digest, image inspection/label validation, immutable identity, and policy argument construction.
- `sandbox/container.ts`: unpredictable names, create/start/attach/inspect/remove, timeout/cancellation/output-limit convergence, cleanup settling, and sandbox factory.

`src/process.ts` is the one trusted host-child helper for lifecycle-compatible Git, Python, Docker, and image-build calls. It owns spawn listener cleanup, input, capture/inherited output, abort/deadline handling, process-group termination, and optional byte limits. Each domain wrapper still supplies its explicit environment and decides whether nonzero exit is an ordinary command result or an infrastructure failure. Model-authored and reviewer-selected shell source continues to execute only through `CommandSandbox`.

### Python Distribution

Move `python/src/palimpsest` to `python/palimpsest`; update Hatch package discovery to `["palimpsest"]` and pytest `pythonpath` to `"."`. Preserve `python/pyproject.toml`, `python/uv.lock`, Python/dependency pins, canonical JSON behavior, and the atomic build destination.

`palimpsest.puzzle` owns deterministic construction. `puzzle/manifest.py` owns agent/stage constants plus `EvidenceStage` and `PuzzleBuild`. `puzzle/shards.py` extracts the current pure word-boundary split, three-stream assignment, pre/post eligible-symbol intersection, and contradiction metrics without file or process access. `build.py` retains corpus input, artifact writing, orchestration, and its private subprocess entry.

`palimpsest.evaluation` owns aggregate checking, overlap observation, and scoring. `score.py` owns `AggregateScore`; `overlap.py` owns overlap enums/findings; the mixed `model.py` is deleted. `serialization.py` moves to the distribution root as the only genuinely shared Python utility. TypeScript updates its private module invocations atomically to `palimpsest.evaluation.checker`, `palimpsest.evaluation.overlap`, and `palimpsest.evaluation.score`.

### Verification and Repository Evidence

Before moving code, preserve the existing seed-17 build identity and capture normalized seed-0 puzzle geometry, checker aggregate, score, contractual trace partial order, and minimum command results in `tests/golden/behavior.json`. File counts, tree digests, exact manifest fields, dynamic paths, timestamps, Git object IDs, image IDs, Docker duration, extra command fields, and unconstrained Git or agent-event interleaving are not frozen.

The repository-boundary test derives the active path set from Git's cached plus nonignored untracked paths minus deleted paths. It restricts assertions to active repository scopes, so ignored caches, empty directories, and the preserved `.artifacts-tmp/` evidence cannot affect the result during an unstaged implementation.

Unit tests move beside their owners. Black-box tests retain CLI contracts, offline completion, real Docker containment, and the new post-freeze overlap-failure/evaluation path. The final acceptance run rebuilds the sandbox image, runs `pnpm verify`, checks whitespace, audits deleted imports/layout, and executes a fresh offline fixture.

## Delivery Sequence

1. Capture the scientific/minimum-command baseline and the untracked artifact hash before moving source.
2. Move the TypeScript runtime and its tests together with the package scripts, TypeScript/Vitest includes, formatting/lint inputs, workspace metadata, aliases, and lock importer needed to discover and verify the new root application. Route all five scripts through `src/cli.ts` and remove `tools/puzzle` without a temporary dual command path.
3. Extract model/provider/fixture/reveal/artifact/overlap and sandbox/process boundaries; add the focused clock, current-version decoder, scenario, and durability tests.
4. Move the Python distribution and tests together with package discovery, pytest/Ruff inputs, TypeScript subprocess module names, and generated lock metadata; refresh the editable environment and validate the unchanged scientific golden build.
5. Persist the attempt summary before overlap, retain the best-effort failure trace, and prove subsequent evaluation plus primary-error preservation.
6. Update architecture, roadmap, README, `AGENTS.md`, `CLAUDE.md`, and current command guidance while removing obsolete layout/configuration references in the same final migration slice; keep `docs/proposal.md` semantically unchanged and specs 006/008 byte-for-byte unchanged.
7. Delete only revalidated generated caches/empty legacy directories, leave `.artifacts-tmp/gate-b-contract-cases.json` untouched, and execute the complete fresh acceptance sequence.

## Complexity Tracking

No constitution violations or exceptions are required. The only nested source directory is the existing sandbox ownership boundary; the only separate runtime project is the existing deterministic Python distribution.
