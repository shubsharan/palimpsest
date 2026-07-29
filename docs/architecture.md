# Architecture

## Purpose

Palimpsest is one local research runner, not a service platform. Its architecture has four responsibilities:

1. validate one declarative experiment before side effects;
2. construct a deterministic, variable-geometry puzzle;
3. run provider-neutral concurrent model sessions inside one attempt; and
4. preserve secret-free attempts for later reviewer-selected evaluation.

One root TypeScript application lives under `src/`. One Python distribution under `python/palimpsest/` owns deterministic puzzle and scoring algorithms. Generated runs live under ignored `artifacts/`.

## Experiment Configuration

The versioned YAML manifest is the operator's source of truth. The checked-in JSON Schema rejects unknown structural keys, while semantic validation resolves corpus, provider, model, and run references before a build or attempt directory is created.

```text
experiment.yaml
  puzzle     target, references, seed, agents, stages, interval, re-keys
  limits     token budget and wall time
  providers  direct driver and credential environment names
  models     provider model IDs and non-secret settings
  runs       homogeneous or ordered mixed assignments and repetitions
```

The resolved in-memory configuration materializes defaults, canonical `agent-1` through `agent-N` identities, ordered model bindings, and repetition ordinals. Credential values are resolved only when a live adapter is constructed and never enter this snapshot.

The supported direct drivers are OpenAI, Anthropic, Google, and OpenAI-compatible endpoints. The Vercel AI SDK is a narrow turn-level adapter: Palimpsest continues to own session loops, tools, token cutoffs, aborts, artifacts, and failure classification. Provider factories do not add gateway, registry, fallback, or attempt-retry behavior.

## Deterministic Construction

`puzzle:build` validates the full manifest and passes canonical resolved puzzle JSON to `palimpsest.puzzle.build`. Python:

1. resolves target and references through `fixtures/corpus/provenance.json`;
2. verifies source byte length and SHA-256 before parsing;
3. extracts the requested one-based inclusive target chapter range while ignoring leading table-of-contents matches;
4. prepares text and derives a base substitution key from the seed;
5. divides evidence into the declared number of contiguous agent streams and stages;
6. derives each configured partial re-key successively from the prior key, using recurring symbols evidenced on both sides of the boundary;
7. writes immutable private stages, versioned oracle keys, checker truth, the complete ciphertext, and public references; and
8. publishes strict `puzzle-build.json` schema version 2.

Construction fails explicitly if a corpus digest, chapter range, path, stage geometry, or re-key request is invalid or infeasible. It does not silently clamp a requested changed-token mass.

For fixed registered source bytes and resolved scientific inputs, build identity, stage bytes, keys, checker truth, and complete evaluation input are deterministic.

## Attempt Runtime

`puzzle:run` selects one canonical condition from the manifest and checks that its block and key regime match the supplied build before creating the output root. It derives communication mode and key regime from the condition identifier and constructs one declared model binding and adapter per agent.

Within an attempt, TypeScript:

- creates one shared ordinary bare Git repository for shared conditions or one independent ordinary repository per agent for isolated conditions, plus one workspace per canonical agent ID;
- creates one private evidence directory and independent persistent session per agent;
- releases equivalent stage ordinals using one monotonic schedule;
- exposes the same local command, file, Git, checker, and activity-waiting tool surface to every session while limiting Git and activity visibility to the declared communication mode;
- enforces provider-reported cumulative input/output token budgets per session and one global wall-time cutoff;
- records requested model identity, optional actual response identity, usage, tool activity, stage activity, Git changes, and termination;
- freezes every condition-visible Git repository and workspace after all sessions end; and
- atomically publishes `attempt.json` before optional overlap observation.

Sessions in one attempt run concurrently. They share neither message history nor private evidence. Shared conditions can observe peer Git activity; isolated conditions retain team identity but cannot observe peer evidence, repositories, or activity. No rounds, roles, checkpoints, mandatory Git behavior, or solver file convention are introduced.

Missing provider usage or a provider request failure is an infrastructure-error session rather than estimated usage or a model-quality outcome. The attempt is still frozen and published. An experiment indexes that durable attempt and then stops before launching another.

## Experiment Orchestration

`puzzle:experiment` validates the complete configuration before creating its absent output root. It builds the puzzle once under `build/`, then executes run conditions and repetitions sequentially in declaration order:

```text
experiment/
  experiment.json
  build/
    puzzle-build.json
  attempts/
    <run-name>/
      001/
        attempt.json
      002/
        attempt.json
```

After each durable attempt, the runner writes a complete temporary experiment summary in the output directory and atomically renames it to `experiment.json`. The summary contains the resolved non-secret configuration, build identity, and ordered completed-attempt entries. It does not aggregate model quality or choose an evaluation.

A command-level failure before attempt publication creates no success-shaped entry. A failure after earlier attempts leaves their artifacts and the last valid summary untouched. There is no automatic resume, rollback, provider fallback, parallel attempt scheduling, or hidden retry.

## Provider And Secret Boundary

Provider connections name credential environment variables rather than literal keys. Official drivers require their API-key variable; compatible endpoints can also resolve configured header environment variables. The selected values:

- remain in trusted host memory only;
- are excluded from resolved configuration and records;
- are not mounted into model-authored or reviewer containers; and
- are scrubbed from provider error messages before storage or standard error.

Model profiles may pass structurally safe, non-secret provider options. Secret, credential, fallback, retry, abort, and provider-selection controls are rejected rather than delegated through configuration.

## Command Sandbox

Model-authored commands run in attempt-scoped Docker sandbox leases rather than directly on the host. The runner creates one lease per configured agent and routes that agent's commands through the same healthy lease. Each lease receives only its writable workspace, currently released private evidence, target-excluded references, condition-visible Git, and private temporary storage. Prepared plaintext, keys, unreleased or peer-private evidence, checker internals, provider credentials, host-control surfaces, and public networking stay outside.

Lease creation and every command share bounded deadlines under the attempt's global wall-time cutoff. A nonzero command leaves a healthy lease available; timeout, cancellation, output overflow, or resource termination abandons the lease so the command cannot continue in the background. A later command may receive a replacement lease over the same host-backed workspace, evidence, reference corpus, and Git repository.

If the Docker runtime interrupts an in-flight command and returns before its deadline, the runner replaces the affected lease and reports the command outcome as indeterminate without replaying it. The agent can inspect persistent workspace and Git state before deciding how to continue. If replacement cannot complete, the session records an infrastructure error. All leases are closed before freeze, including when staged evidence, monitoring, or other cleanup work fails.

Reviewer-selected evaluation uses a separate short-lived container with a copy of the selected frozen workspace, complete ciphertext, frozen Git, and temporary storage. The reviewer must explicitly record the workspace, command, and output path before execution.

The sandbox protects the local host and oracle. It is not presented as a hardened public benchmark or proof that a solver cannot exploit the puzzle.

## Trace And Artifacts

The append-only trace is validated, redacted, and sequence-ordered across run, overlap, and evaluation. Configured events identify the build, dynamic agent/stage/re-key counts, run and repetition, and requested model bindings without exposing hidden changed symbols. Session events may record actual provider/model identity and normalized usage.

`attempt.json` contains the block, condition, communication mode, key regime, protocol identity, build identity, agent set, model binding per session, usage, termination, every frozen Git repository and workspace, trace, sandbox identity, and operational limits. It is the durable evaluation boundary.

Optional post-freeze overlap observation reports obvious exact or normalized raw text overlap without warning, blocking, invalidating, or rescoring the run. If observation fails, the already published attempt remains evaluatable.

## Operator Commands

All commands dispatch through `src/cli.ts` and emit one JSON object on success:

```bash
pnpm preflight
pnpm puzzle:build -- --config experiments/config.yaml --output artifacts/build
pnpm puzzle:run -- --config experiments/config.yaml --run gpt-only \
  --build artifacts/build --output artifacts/attempt
pnpm puzzle:experiment -- --config experiments/config.yaml \
  --output artifacts/experiment
pnpm puzzle:evaluate -- --attempt artifacts/attempt --workspace agent-1 \
  --command "sh solve.sh" --output-path reconstruction.txt
pnpm puzzle:offline -- --output artifacts/offline
```

The offline command composes the same build, dynamic runtime, freeze, overlap, and evaluation path with deterministic fixture adapters and no external model call.

## Failure Semantics

Configuration, build, adapter construction, provider execution, sandbox, Git, trace, artifact publication, overlap, and evaluation failures remain explicit infrastructure outcomes. Model mistakes, tool errors, repeated checking, raw sharing, no Git use, unusual coordination, and voluntary early completion remain observable model outcomes.

The architecture preserves the strongest durable boundary available: publication of a complete attempt before optional observation, and publication of a complete experiment summary after each durable attempt.

`pnpm preflight` is the authorization boundary for provider-backed work. It requires a clean committed checkout, rebuilds the sandbox, runs full verification plus a fresh offline fixture, and writes `artifacts/preflight.json` only on success. A provider-backed attempt must match that receipt before model sessions begin and copies it into the attempt root first.

## Verification

The repository verifies strict config decoding, mocked provider turns and credential scrubbing, deterministic paired blocks, canonical condition derivation, concurrent sessions, shared peer visibility, isolated Git and activity non-observability, identical non-treatment inputs, stage scheduling, trace and artifact decoding, attempt durability, sequential experiment indexing, reviewer-selected evaluation, and Docker containment.

Canonical acceptance is:

`pnpm check` plus a sandbox image build provides advisory mechanical feedback for pull requests and pushes to `main`; it checks locked dependencies, formatting, lint, compilation, and the Dockerfile without running test suites, and is not a required merge gate. `pnpm preflight` is the canonical consequential-research check: it runs the full `pnpm verify` suite, rebuilds and identifies the agent-visible sandbox, executes a fresh scored offline fixture, and records the tested commit. Publication review uses the copied attempt receipt and `attempt.json.sandbox` to identify the verified runner and experimental environment.

No verification command requires provider credentials or a billable model request.
