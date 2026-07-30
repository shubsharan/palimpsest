# Architecture

## Purpose

Palimpsest is one local research runner, not a service platform. Its architecture has four responsibilities:

1. validate one declarative experiment before side effects;
2. construct deterministic paired puzzle blocks;
3. run provider-neutral concurrent model sessions inside one attempt; and
4. preserve secret-free attempts for later reviewer-selected evaluation.

One root TypeScript application lives under `src/`. One Python distribution under `python/palimpsest/` owns deterministic puzzle and scoring algorithms. Generated runs live under ignored `artifacts/`.

## Experiment Configuration

The five-entry `experiments/blocks.json` catalog owns scientific block inputs. One strict schema-version-2 YAML manifest freezes the complete study protocol. Both reject unknown fields before build or attempt side effects.

```text
study.yaml
  blocks            one calibration and four validation IDs
  assignment        three ordered agent/model bindings
  schedule          six release offsets and cutoff
  budgets           per-attempt values and immutable total ceilings
  providers/models  direct drivers, environment names, and model IDs
  orders            calibration plus four balanced validation sequences
  scoring/rubric    deterministic metric and descriptive review boundary
  failurePolicy     stop, no retry, explicit cited replacement
```

The block catalog pins target and references, seed, first-feasible prose window, and fixed three-agent/six-stage geometry. The resolved study materializes the exact twenty planned cells and three-agent assignment without reading credentials. Only the per-agent token budget and per-attempt monetary authorization cents may change after calibration, within immutable total ceilings and with an explicit adjustment record. Credential values are resolved only after study checks and provider preflight and never enter the resolved manifest or artifacts.

The supported direct drivers are OpenAI, Anthropic, Google, and OpenAI-compatible endpoints. The Vercel AI SDK is a narrow turn-level adapter: Palimpsest continues to own session loops, tools, token cutoffs, aborts, artifacts, and failure classification. Provider factories do not add gateway, registry, fallback, or attempt-retry behavior.

## Deterministic Construction

`puzzle:build --block` loads one committed catalog entry and invokes `palimpsest.puzzle.build`. Python:

1. resolves target and references through `fixtures/corpus/provenance.json`;
2. verifies source byte length and SHA-256 before parsing;
3. canonicalizes Gutenberg-body blank-line blocks or HTML paragraphs and revalidates the committed first-feasible window;
4. performs the bounded tiered paragraph allocation and oracle-set selection;
5. derives one base key plus stationary and stage-four re-key variants;
6. verifies complete paragraph union, pre-boundary twin identity, stable controls, and old-key degradation;
7. writes variant stage trees, complete ciphertexts, checker truth, keys, allocation, design, and manipulation records; and
8. atomically publishes strict `puzzle-build.json` schema version 3.

Discovery writes `discovery.json` only. A normal build fails if its committed window is not the deterministic first feasible result, all tiers are infeasible, oracle constraints fail, twins diverge before stage four, or manipulation checks fail.

For fixed registered source bytes, block definition, and builder version, the window, allocation, keys, both variant stage trees, oracle records, and build identities are deterministic. Release timing is not part of build identity.

## Attempt Runtime

`puzzle:run` uses the fixed manifest assignment and one strict `CS`, `CR`, `IS`, or `IR` condition. It checks that the supplied paired build is one of the registered study blocks, derives the stationary or re-key variant and shared or isolated topology, then constructs one declared model binding and adapter per agent.

Within an attempt, TypeScript:

- creates one shared bare Git repository or three isolated bare repositories, plus one assigned workspace per canonical agent ID;
- creates one private evidence directory and independent persistent session per agent;
- releases equivalent stage ordinals at 0, 5, 10, 20, 30, and 40 minutes on one monotonic schedule;
- exposes the same local command, file, Git, checker, and activity-waiting tool surface to every session;
- enforces provider-reported cumulative input/output token budgets per session and one fixed 60-minute cutoff;
- records requested model identity, optional actual response identity, usage, tool activity, stage activity, Git changes, and termination;
- freezes every native Git repository and workspace without merging after all sessions end; and
- atomically publishes `attempt.json` before optional overlap observation.

Sessions in one attempt run concurrently. They share neither message history nor private evidence. No rounds, roles, checkpoints, mandatory Git behavior, or solver file convention are introduced by the study protocol.

Missing provider usage or a provider request failure is an infrastructure-error session rather than estimated usage or a model-quality outcome. The attempt is still frozen and published. An experiment indexes that durable attempt and then stops before launching another.

## Experiment Orchestration

`puzzle:experiment --phase calibration|validation` expands one fixed local state machine. Calibration prepares and validates all five builds, seals each complete build tree, and binds those seals plus prompt templates, rubric, assignment, order, scoring, failure rules, and sandbox identity before exclusively publishing `design.json`. Validation requires that receipt, a completed calibration phase, and unchanged build trees.

```text
study/
  design.json
  builds/
    <block-id>/
      puzzle-build.json
  calibration/
    phase.json
    attempts/
      <attempt-id>/
        attempt.json
  validation/
    phase.json
    attempts/
      <attempt-id>/
        attempt.json
```

Before phase initialization, the runner exclusively creates one empty phase-execution lock and holds it for the complete invocation. A competing or abandoned lock fails before preflight, reservation, adapter construction, or provider work; there is no heartbeat, lock stealing, or stale-process recovery. Immediately before opening a cell's sessions, the runner reverifies the selected receipt-bound build tree and writes one launch reservation to the phase summary. After the sessions and Git freeze complete, it reverifies the selected build and only then publishes immutable `attempt.json`, indexes the attempt, resolves the reservation, accounts its full token and monetary authorization, and continues to the next cell. A crash before durable attempt publication leaves an unresolved reservation, so resume cannot silently become a retry.

A frozen `session-infrastructure-error` attempt is indexed unchanged and stops the phase nonzero. Only `--replace <attempt-id>` can append one inherited replacement. Model outcomes, post-publication overlap/evaluation errors, pre-freeze failures, missing sources, and already-replaced attempts are ineligible. A post-publication overlap error remains diagnostic: the durable non-infrastructure attempt is indexed and the phase continues sequentially without manual resume. Successful resume skips every indexed cell. There is no rollback, provider fallback, parallel attempt scheduling, hidden retry, result selection, or aggregation.

## Provider And Secret Boundary

Provider connections name credential environment variables rather than literal keys. Official drivers require their API-key variable; compatible endpoints can also resolve configured header environment variables. The selected values:

- remain in trusted host memory only;
- are excluded from resolved configuration and records;
- are not mounted into model-authored or reviewer containers; and
- are scrubbed from provider error messages before storage or standard error.

Model profiles may pass structurally safe, non-secret provider options. Secret, credential, fallback, retry, abort, and provider-selection controls are rejected rather than delegated through configuration.

## Command Sandbox

Model-authored commands run in attempt-scoped Docker sandbox leases rather than directly on the host. The runner creates one lease per configured agent and routes that agent's commands through the same healthy lease. Each lease receives only its writable workspace, currently released private evidence, target-excluded references, assigned Git origin at `/git/origin.git`, and private temporary storage. In isolated conditions no peer origin is mounted. Prepared plaintext, keys, unreleased or peer evidence, checker internals, provider credentials, host-control surfaces, and public networking stay outside.

Lease creation and every command share bounded deadlines under the attempt's global wall-time cutoff. A nonzero command leaves a healthy lease available; timeout, cancellation, output overflow, or resource termination abandons the lease so the command cannot continue in the background. A later command may receive a replacement lease over the same host-backed workspace, evidence, reference corpus, and Git repository.

If the Docker runtime interrupts an in-flight command and returns before its deadline, the runner replaces the affected lease and reports the command outcome as indeterminate without replaying it. The agent can inspect persistent workspace and Git state before deciding how to continue. If replacement cannot complete, the session records an infrastructure error. All leases are closed before freeze, including when staged evidence, monitoring, or other cleanup work fails.

Reviewer-selected evaluation first reverifies the complete selected-build and frozen Git/workspace tree seals, then uses a separate short-lived container with a copy of the selected frozen workspace, complete ciphertext, that workspace's assigned frozen Git origin, and temporary storage. The reviewer must explicitly record the workspace, command, and output path before execution.

The sandbox protects the local host and oracle. It is not presented as a hardened public benchmark or proof that a solver cannot exploit the puzzle.

## Trace And Artifacts

The append-only trace is validated, redacted, and sequence-ordered across run, overlap, and evaluation. Configured events identify standalone or study phase, condition, derived treatment, selected variant build, fixed schedule and cutoff, resource authorization, and requested model bindings without exposing block order, rubric, replacement policy, oracle sets, or hidden changed symbols. Session events may record actual provider/model identity and normalized usage.

`attempt.json` schema version 4 contains the block, condition, derived treatment, selected build and complete-tree seal, exact schedule, protocol snapshot and digest, fixed three-agent set, model binding per session, usage, termination, native frozen Git inventory and complete-tree seal, trace, sandbox identity, token limit, monetary authorization, infrastructure classification, and optional study/replacement provenance. It is the durable evaluation boundary.

The canonical tree-sealing primitive covers sorted relative paths, directories, file bytes and lengths, executable bits, and symlink targets. It replaces per-consumer artifact lists, so new builder, checker, runner, or evaluator inputs are bound automatically when they live under the published root. This is local drift detection under a trusted-operator model, not cryptographic attestation: a coherent rewrite of artifacts and their embedded seals, signatures, immutable storage, and an external transparency service are outside the project boundary.

Optional post-freeze overlap observation reports obvious exact or normalized raw text overlap without warning, blocking, invalidating, or rescoring the run. If observation fails, the already published attempt remains evaluatable.

## Operator Commands

All commands dispatch through `src/cli.ts` and emit one JSON object on success:

```bash
pnpm preflight
pnpm puzzle:build -- --block calibration-theron-ware --output artifacts/build
pnpm puzzle:run -- --config experiments/config.yaml \
  --condition CR --build artifacts/build --attempt-root artifacts/attempt
pnpm puzzle:experiment -- --config experiments/config.yaml \
  --phase calibration --study-root artifacts/study
pnpm puzzle:experiment -- --config experiments/config.yaml \
  --phase validation --study-root artifacts/study
pnpm puzzle:experiment -- --config experiments/config.yaml \
  --phase validation --study-root artifacts/study --replace <attempt-id>
pnpm puzzle:evaluate -- --attempt artifacts/attempt --workspace agent-1 \
  --command "sh solve.sh" --output-path reconstruction.txt
pnpm puzzle:offline -- --condition CR --output artifacts/offline
```

The offline command composes the same condition-selected build, runtime, native freeze, overlap, and evaluation path with deterministic fixture adapters, a fake monotonic clock, and no external model call.

## Failure Semantics

Configuration, build, adapter construction, provider execution, sandbox, Git, trace, artifact publication, overlap, and evaluation failures remain explicit infrastructure outcomes. Only a frozen session-infrastructure classification is replacement-eligible. Model mistakes, tool errors, repeated checking, raw sharing, no Git use, unusual coordination, and voluntary early completion remain observable model outcomes.

The architecture preserves the strongest local durable boundary available: exclusive design-receipt publication before sessions, one local phase writer, whole-tree verification before launch and attempt publication, launch reservation before provider work, complete attempt publication before optional observation, and atomic phase indexing after each durable attempt.

`pnpm preflight` is the authorization boundary for provider-backed work. It requires a clean committed checkout, rebuilds the sandbox, runs full verification plus a fresh offline fixture, and writes `artifacts/preflight.json` only on success. A provider-backed attempt must match that receipt before model sessions begin and copies it into the attempt root first.

## Verification

The repository verifies pinned corpus provenance, canonical paragraph extraction, deterministic first-feasible windows, complete paragraph allocation, oracle-set geometry, paired pre-boundary identity, stationary stability, old-key degradation, all four condition mappings, prompt parity, shared visibility, isolated non-observability, exact stage scheduling, strict attempt decoding, native topology freezing, attempt durability, selected-origin evaluation, and Docker containment.

## Study Conditions And Frozen Protocol

Feature 014 implements canonical `CS`, `CR`, `IS`, and `IR` conditions, isolated repositories, exact release timing, and complete native topology records. Feature 015 replaces the transitional run list with one calibration block, four validation blocks, one fixed three-model assignment, balanced orders, immutable scientific design, bounded operational adjustments, and explicit failure lineage.

Canonical acceptance is:

`pnpm check` plus a sandbox image build provides advisory mechanical feedback for pull requests and pushes to `main`; it checks locked dependencies, formatting, lint, compilation, and the Dockerfile without running test suites, and is not a required merge gate. `pnpm preflight` is the canonical consequential-research check: it runs the full `pnpm verify` suite, rebuilds and identifies the agent-visible sandbox, executes a fresh scored offline fixture, and records the tested commit. Publication review uses the copied attempt receipt and `attempt.json.sandbox` to identify the verified runner and experimental environment.

No verification command requires provider credentials or a billable model request.
