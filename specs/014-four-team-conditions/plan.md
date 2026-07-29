# Implementation Plan: Four Team Conditions

**Branch**: `feature/014-four-team-conditions` | **Date**: 2026-07-28 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `specs/014-four-team-conditions/spec.md`

## Summary

Add one strict condition layer that derives shared/isolated Git topology and stationary/re-key build selection from `CS`, `CR`, `IS`, or `IR`. Replace arithmetic reveal timing with the fixed six-offset schedule, give each agent a condition-appropriate origin at one stable sandbox path, keep activity sequences private, make the prompt behavior-neutral, and extend durable attempt records just enough to evaluate and inspect either topology without merging.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; existing Python 3.12.4 scoring/overlap subprocesses remain unchanged except for request inputs **Primary Dependencies**: Node standard library, existing Ajv/YAML configuration, RFC 8785-capable Python artifact helpers, Git CLI, current command sandbox and provider adapters **Storage**: Plain attempt directories containing traces, schema-version-3 attempt JSON, frozen repositories/workspaces, overlap records, and explicit evaluation results **Testing**: Vitest 4.1.10 unit/integration tests with fixture adapters and monotonic fake clocks; existing pytest, Ruff, Oxlint, Oxfmt **Target Platform**: Local macOS or Linux with Git; Docker only for real command-sandbox/preflight paths **Project Type**: Local dual-runtime research CLI **Performance Goals**: Create and freeze three local repositories/workspaces without network access; exact fake-clock releases at six declared offsets **Constraints**: Exactly three agents, six stages, fixed 60-minute cutoff, no live provider call in acceptance, no peer side channel in isolated mode, no post-hoc merge, no new service **Scale/Scope**: One condition module; narrow changes to reveal, Git, run, prompt, artifacts, overlap, evaluation, config, CLI, and tests **Puzzle Contribution**: Crosses native peer communication availability with the stationary/re-key evidence treatment while preserving one team identity and open-ended solving **Agent Instructions & Tools**: Same objective, team identity, private evidence, references, commands, aggregate checker, optional unmetered Git, activity wait, limits, paths, evaluation boundary, and requested final response; only the communication-channel paragraph varies **Environmental Constraints**: Shared agents see one team origin and peer activity; isolated agents see only their own usable origin and activity at the same path; schedule, evidence, tools, sandbox, models, limits, and evaluation stay paired **Observable Outcomes**: Condition and derived treatment, prompts, stage timestamps, visible Git events, refs, sessions, usage, termination, sandbox identity, frozen topology, overlap, reviewer selection, and score **Determinism Claim**: Condition resolution, selected build variant, schedule, prompt bytes, repository topology, artifact validation, overlap inputs, and scoring are deterministic; model responses and concurrent Git interleavings are not

## Constitution Check

- **Puzzle behavior before process - PASS**: The prompt removes the current coordination, role, branch, review, "best solver," and raw-sharing advice. It states only identity, objective, available environment, limits, and requested output.
- **Environmental constraints, not workflow - PASS**: Communication and evidence visibility are treatment inputs independent of model behavior. No Git operation, turn, checkpoint, artifact, or coordination cadence is required.
- **Minimal reproducible mechanics - PASS**: One four-entry mapping, one explicit schedule, one generalized Git topology, and one attempt-schema revision solve current treatment and evaluation needs. No service, database, retry engine, reviewer automation, or generic experiment framework is added.
- **Observe outcomes honestly - PASS**: Independent work, no Git use, conflicts, raw sharing, early completion, checker use, and failed collaboration remain recorded model outcomes. Only declared infrastructure failures stop execution.
- **Condition-defined native collaboration - PASS**: Shared agents receive one peer-visible origin; isolated agents receive independent usable origins and private activity streams. Team identity and every non-communication input remain stable.
- **Risk-aligned verification - PASS**: Fixture adapters and fake clocks verify treatment mechanics. Advisory checks remain non-authorizing and provider-backed research still requires the existing clean receipt-bound preflight.

Post-design re-check: PASS. Per-agent activity buses prevent hidden isolated events from producing visible cursor gaps; selected-workspace evaluation mounts only the corresponding frozen origin; overlap scans each origin independently; no model work is synthesized or merged.

## Project Structure

### Documentation

```text
specs/014-four-team-conditions/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── condition-runtime.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
src/
├── condition.ts
├── condition.test.ts
├── activity.ts
├── activity.test.ts
├── git.ts
├── git.test.ts
├── reveal.ts
├── reveal.test.ts
├── prompt.ts
├── prompt.test.ts
├── run.ts
├── run.test.ts
├── artifacts.ts
├── artifacts.test.ts
├── overlap.ts
├── overlap.test.ts
├── evaluate.ts
├── evaluate.test.ts
├── config.ts
├── configured-run.ts
├── experiment.ts
├── offline.ts
└── sandbox/
    ├── contracts.ts
    ├── docker.ts
    └── docker.test.ts

tests/puzzle/
├── cli.test.ts
└── offline.test.ts

experiments/
├── config.yaml
└── schema.json
```

**Structure Decision**: Keep condition derivation in one new TypeScript module because TypeScript already owns sessions, timing, Git, prompts, sandbox mounts, traces, and operator commands. Generalize the existing Git value object rather than adding parallel shared and isolated runtimes. Keep Python puzzle generation and scoring unchanged.

## Phase 0 Decisions

See [research.md](research.md). All treatment identifiers, schedule values, visibility semantics, prompt invariants, artifact fields, and transitional schema-v1 behavior are resolved.

## Phase 1 Design

### Canonical Condition Boundary

`resolveCondition` is the sole decoder:

| Condition | Communication | Variant      |
| --------- | ------------- | ------------ |
| `CS`      | `shared`      | `stationary` |
| `CR`      | `shared`      | `rekey`      |
| `IS`      | `isolated`    | `stationary` |
| `IR`      | `isolated`    | `rekey`      |

No API accepts communication mode or key regime independently. CLI/config inputs supply only the canonical condition identifier. Runtime, overlap, evaluation, trace, and artifact validation derive the same treatment from it.

### Exact Schedule

The condition module owns immutable release offsets `[0, 300000, 600000, 1200000, 1800000, 2400000]` and cutoff `3600000`. `runRevealSchedule` accepts the complete offset vector and waits on the existing monotonic clock. Stage one is published at offset zero before sessions open. The wall timer and prompt use the same cutoff constant.

Schema v1 remains only as a temporary F014 model/run assignment surface: its puzzle field selects `block`, its limits field selects `tokenBudgetPerAgent`, and `puzzle:run`, `puzzle:experiment`, and `puzzle:offline` require one `--condition`. Feature 015 replaces the schema and run shape rather than preserving this bridge.

### Git And Activity Topology

`GitEnvironment` owns repositories and workspaces:

- Shared: one `shared.git`, referenced by all three workspaces.
- Isolated: one `<agent-id>.git` per workspace.

Every workspace configures `origin` to `/git/origin.git`; every sandbox lease receives only its assigned host origin. The monitor reports ref changes but the runner owns visibility. Each agent has a private `ActivityBus`: stage release enters only its bus; shared ref changes enter all three; isolated ref changes enter only the owner bus. Visible sequences remain contiguous and disclose no hidden peer event.

Freeze copies every repository and workspace into its native topology. It neither merges isolated repositories nor chooses a team output.

### Prompt Contract

The prompt is assembled from:

1. invariant team identity and different-private-evidence statement;
2. exactly one shared or isolated channel paragraph;
3. invariant objective;
4. exact schedule, cutoff, and cumulative token limit;
5. invariant tools, paths, reference, checker, wait, and explicit manual-evaluation boundary; and
6. requested final response.

`CS` and `CR` prompts are byte-identical for a given agent/config. `IS` and `IR` prompts are byte-identical. Removing the one channel paragraph makes shared and isolated prompts byte-identical. There is no advice about roles, algorithms, branches, commits, review, artifacts, raw sharing, or coordination cadence.

### Attempt, Overlap, And Evaluation

Attempt schema version 3 records `blockId`, `condition`, derived `communicationMode` and `keyRegime`, selected `variantId` and `buildId`, exact release offsets, cutoff, token budget, protocol digest, frozen repositories/workspaces, sessions, trace, and sandbox identity. The protocol digest hashes a fixed-order secret-free snapshot of these declared attempt inputs and prompt texts; the snapshot is stored alongside the digest so it is auditable rather than magical.

Overlap resolves the variant from the persisted condition, scans each frozen repository independently, prefixes isolated paths with the owning agent ID, combines findings and additive scan counts, and never affects the score. Manual evaluation resolves the same variant and mounts only the selected workspace's assigned frozen repository. Shared evaluation therefore sees the team origin; isolated evaluation sees only the selected agent's origin.

### Failure Boundary

Invalid conditions, treatment/build mismatch, impossible topology, missing assigned origin/workspace, schedule mismatch, monitor failure, freeze failure, strict artifact failure, and evaluation mount mismatch are infrastructure errors. Git conflicts, absence of commits, early final responses, unsuccessful solutions, and communication choices are not.

## Complexity Tracking

No Constitution violations or exceptions.
