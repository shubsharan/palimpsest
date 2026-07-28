# Implementation Plan: Configurable Research Runs

**Branch**: `011-configurable-research-runs` | **Date**: 2026-07-27 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/011-configurable-research-runs/spec.md`

## Summary

Replace the fixed OpenAI live path and implicit three-agent puzzle profile with one strict YAML experiment manifest. Keep Palimpsest a local dual-runtime CLI: TypeScript validates and resolves provider/model/run configuration, the existing provider-neutral `ModelAdapter` owns one model turn at a time through AI SDK provider packages, and Python deterministically builds a variable-agent, variable-stage puzzle with zero or more successive partial re-keys. Add a sequential `puzzle:experiment` wrapper that builds once, runs declared homogeneous or mixed-model repetitions, and atomically indexes durable attempts; retain reviewer-selected evaluation and the behavior-neutral agent environment.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: AI SDK 7.0.38; `@ai-sdk/openai` 4.0.21; `@ai-sdk/anthropic` 4.0.22; `@ai-sdk/google` 4.0.25; `@ai-sdk/openai-compatible` 3.0.15; Zod 4.4.3; YAML 2.9.0; Ajv 8.20.0; Node standard library; Docker/Git; existing Python `rfc8785` **Storage**: Checked-in YAML manifests and corpus provenance; generated build, attempt, trace, evaluation, and experiment-summary files; ordinary bare Git repository and frozen workspaces **Testing**: Vitest 4.1.10, pytest 9.1.1, Ruff 0.16.0, Oxlint 1.75.0, Oxfmt 0.60.0, real Git/Docker integration tests, mocked AI SDK language models, and a fresh offline fixture **Target Platform**: macOS or Linux host with Docker Engine/Desktop; Linux command containers **Project Type**: Local dual-runtime research CLI **Performance Goals**: Validate a manifest before side effects; preserve configured monotonic stage offsets and wall/token cutoffs; start each next attempt only after the prior attempt is durable; add no provider gateway or background service **Constraints**: No provider fallback or hidden retry; no provider credentials in artifacts or sandboxes; no prescribed agent workflow or output path; target corpus excluded from references; at least two agents; generated agent IDs and stages remain bounded by available corpus evidence **Scale/Scope**: One puzzle per manifest; four provider driver families; a small researcher-authored run list; sequential repetitions; dynamic two-or-more agent streams; one-or-more stages; zero-or-more stage-boundary partial re-keys **Puzzle Contribution**: Makes corpus, team size, stage geometry, hidden key revisions, models, and repetitions explicit research conditions without changing the open-ended decipherment objective **Agent Instructions & Tools**: Preserve the shared reconstruction objective, dynamic peer count, private evidence, target-excluded references, local commands, aggregate checker, ordinary Git, activity waiting, and requested but unenforced compact sharing **Environmental Constraints**: Peers in one attempt receive identical reveal geometry, cutoffs, sandbox policy, tool surface, and secret isolation; model assignment may differ only when explicitly declared as the research condition **Observable Outcomes**: Retain resolved non-secret configuration, requested and actual model identity, normalized provider usage, turns, tools, stages, checker calls, Git, termination, frozen work, overlap, reviewer selection, execution, and score **Determinism Claim**: Fixed resolved puzzle inputs reproduce corpus selection, shards, successive keys, staged evidence, checker truth, and scoring inputs; provider behavior, serving version, sampling, event interleaving, and reviewer judgment remain nondeterministic

## Constitution Check

_GATE: Passed before Phase 0 research and passed again after Phase 1 design._

- **Puzzle behavior before process — PASS**: Configuration changes the condition, not the solving instructions. Prompts still avoid algorithms, roles, turns, checkpoints, required files, and reasoning artifacts.
- **Environmental constraints, not workflow — PASS**: Dynamic evidence geometry and resource limits remain fixed before an attempt and independent of model behavior. Sequential experiment attempts do not synchronize sessions inside an attempt.
- **Minimal reproducible mechanics — PASS**: One YAML file, one strict decoder, one provider adapter, and one small summary directly serve current research and sharing needs. No service, database, gateway, plugin runtime, retry engine, or analysis platform is added.
- **Observe outcomes honestly — PASS**: Provider errors and missing usage remain infrastructure outcomes; incorrect work, mixed-model behavior, unusual coordination, and non-collaboration remain model observations.
- **Voluntary native collaboration — PASS**: Every multi-agent condition retains explicit peer context and ordinary unmetered Git without requiring its use.

## Project Structure

### Documentation (this feature)

```text
specs/011-configurable-research-runs/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── experiment-config.md
│   ├── operator-cli.md
│   └── research-artifacts.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
experiments/
├── schema.json
└── config.yaml

src/
├── cli.ts
├── config.ts
├── config.test.ts
├── experiment.ts
├── experiment.test.ts
├── model.ts
├── provider.ts
├── provider.test.ts
├── build.ts
├── run.ts
├── artifacts.ts
├── prompt.ts
├── git.ts
├── trace.ts
└── [existing runtime owners]

python/palimpsest/puzzle/
├── build.py
├── corpus.py
├── manifest.py
├── revision.py
└── shards.py

tests/
├── golden/behavior.json
├── puzzle/
│   ├── cli.test.ts
│   ├── offline.test.ts
│   └── experiment.test.ts
└── integration/verification.test.ts
```

**Structure Decision**: Retain the flat root TypeScript application and the existing Python scientific boundary. Add only `config.ts` for manifest ownership and `experiment.ts` for sequential composition; provider-specific AI SDK packages are selected in `provider.ts`, while session lifecycle remains in `session.ts`. Keep one checked-in `experiments/` interface directory because manifests and their schema are researcher inputs, not runtime source.

## Design

### Manifest and Resolution

`experiments/schema.json` is the structural source of truth. `src/config.ts` parses YAML, validates it with strict Ajv settings, resolves defaults and references, then performs relationship checks that JSON Schema cannot express cleanly: corpus exclusion, agent assignment length, ordered unique re-key stages, selected credential availability, and model/provider linkage. Validation completes before build or attempt directories are created.

The schema has `additionalProperties: false` throughout. It permits one puzzle, one limits block, named provider connections, named model profiles, and ordered named run conditions. Official providers require an environment-variable reference; OpenAI-compatible endpoints require a base URL and may omit credentials for a local endpoint. Common model settings are explicitly typed; provider-specific options are JSON values passed through and recorded after recursively rejecting secret-bearing keys, call-control overrides, and Anthropic native fallback configuration. Literal credential fields are not part of the schema.

The resolved configuration retains credential environment-variable names but never their values. `puzzle:build` consumes the puzzle section; `puzzle:run` consumes one named run condition and the same limits; `puzzle:experiment` composes both. Existing provider-specific live flags are removed rather than maintained as a second configuration path. Fixture construction remains an injected internal path for offline and automated verification.

### Provider-Neutral Model Sessions

`src/model.ts` keeps the Palimpsest `ModelAdapter`/`ModelSession` contract so the existing session loop continues to own tool execution, observation, token cutoffs, and cancellation. `src/provider.ts` replaces the OpenAI Responses decoder with one `AiSdkModelAdapter`. It resolves a configured provider model through the four pinned AI SDK provider packages and performs exactly one provider generation per `respond` call.

The adapter stores AI SDK `ModelMessage` history and pending tool-call names per opened session. On a first request it adds the prompt; on later requests it rejects unknown, duplicate, missing, cyclic, or non-JSON tool results, then adds one tool-role message paired to the preceding assistant calls. It exposes Palimpsest tool definitions with `tool()` and `jsonSchema()` without provider-side `execute` functions, maps returned tool calls into the existing contract, and appends AI SDK v7 `responseMessages` only after a successful turn. `abortSignal` is forwarded. AI SDK retries are fixed to zero, no fallback model is configured, and missing normalized input or output token counts fail explicitly.

Each configured agent binding carries requested provider ID, driver, model ID, common settings, and provider options. Attempt sessions also retain the response model identifier reported by AI SDK, labeled as provider-reported rather than independently verified because the SDK may use the requested ID when a provider omits one. Credential values and raw provider response bodies are never copied into traces. Provider errors are scrubbed against every resolved secret value before they cross into session state, traces, artifacts, standard error, or tool-visible output.

### Dynamic Puzzle Geometry

The resolved puzzle definition is sent to the private Python builder as canonical JSON on standard input, avoiding YAML parsing and provider concepts in Python. Corpus provenance records gain explicit relative path and format fields; target and reference files are byte-length and digest checked before use. Chapter selection is one-based inclusive. The Gutenberg parser discards leading table-of-contents matches before the first real Chapter I/1 so the convention works across all registered sources while preserving the current Middlemarch X-XV prepared bytes.

Python generates `agent-1` through `agent-N`, splits prepared target text into `agentCount * stageCount` contiguous segments, and assigns equal stage cardinality. Re-key entries use unique ascending `atStage` values. Stage key version is the number of transitions whose `atStage` is less than or equal to the stage ordinal.

Each transition derives a deterministic partial revision from the immediately preceding key. Eligibility is computed across every agent for the immediately adjacent pre/post key-version regions so the changed symbols recur on both sides for all peers. Changed-token mass is measured over the new region. The current silent mass clamp is removed: an unattainable mass or insufficient stable control evidence fails with the transition stage and reason. Symbols may change again in a later transition. Zero re-keys produces one stationary key.

Build schema version 2 stores resolved corpus identity/digests, agent and stage counts, a `rekeys` array, per-stage numeric `keyVersion`, and oracle key paths. Current-version readers are updated without a v1 migration. The checked-in baseline manifest reproduces the current three-agent, six-stage, stage-four re-key scientific fixture; any unavoidable identifier change is captured explicitly in the updated golden.

### Experiment Lifecycle and Evaluation

`puzzle:experiment -- --config <yaml> --output <absent-directory>` resolves once, builds into `build/`, then executes each run condition and repetition sequentially into `attempts/<run-name>/<NNN>/`. One model profile applies to all generated agent IDs for a homogeneous condition; an ordered array binds mixed conditions.

After each attempt summary is durable, `src/experiment.ts` atomically publishes `experiment.json` containing schema version, resolved non-secret configuration, build root, and completed attempt entries. A provider infrastructure-error session still freezes and publishes as an observable completed attempt; after indexing it, the experiment stops nonzero before another attempt. A later command-level failure leaves the last complete summary and all earlier attempts untouched. There is no automatic resume, retry, deletion, or rollback; rerunning requires a new absent output root.

Reviewer selection stays in `puzzle:evaluate`. The experiment summary points to attempt roots, and evaluation artifacts remain owned by each attempt. The runner does not guess or require solver files.

### Documentation and Verification

Update the proposal, architecture, roadmap, README, active Spec Kit artifacts, `AGENTS.md`, and `CLAUDE.md` together so the default remains a three-agent/six-stage/one-re-key puzzle while those values become an explicit baseline condition. Document provider token-accounting and serving differences as interpretation limits.

Verification uses fixture adapters and mocked AI SDK language models only. No CI or offline test loads live credentials or performs a billable provider call. The full gate retains Docker sandbox, trace, Git, checker, overlap, evaluation, and whitespace checks.

## Complexity Tracking

No constitution violations or exceptions are required. The two new root modules and one checked-in experiment directory correspond directly to researcher-authored configuration and sequential experiment composition.
