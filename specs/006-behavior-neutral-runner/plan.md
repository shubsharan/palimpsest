# Implementation Plan: Behavior-Neutral Multi-Agent Puzzle Runner

**Branch**: `006-behavior-neutral-runner` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md) **Input**: Feature specification from `/specs/006-behavior-neutral-runner/spec.md`

## Summary

Replace the active evidence-gated harness with a small three-agent runner that stages deterministic private cipher segments, supplies local tools and ordinary shared Git, and lets each persistent model session choose how to work until it finishes or reaches a token or wall-time cutoff. A hidden shared partial re-key makes part of a previously useful rule stop working so the experiment can observe whether agents detect the contradiction, collaborate to review the rule, and update it rather than forcing it to fit. Keep puzzle construction, aggregate private checking, lifecycle supervision, raw observation, and final reviewer-selected scoring deterministic. Treat every collaboration strategy and workaround as an observed result rather than a validity condition.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: Node standard library, `openai` 2.48.0 for the optional live adapter, existing Palimpsest generation and cipher modules **Storage**: Attempt-local files, JSON/JSONL observations, agent-private directories, and a local bare Git repository **Testing**: Vitest 4.1.10, pytest 9.1.1, Hypothesis 6.161.5, deterministic offline fixture adapter **Target Platform**: Local Linux/macOS host with Git 2.48+; Docker is not required by the canonical offline path **Project Type**: Hybrid TypeScript CLI/runtime and Python puzzle/scoring library **Performance Goals**: An offline six-stage fixture completes in under 30 seconds; wake propagation occurs within one supervisor polling interval; cutoff shutdown completes within 5 seconds **Constraints**: Exactly three persistent sessions; six fixed wall-clock stages; one shared hidden transition; private evidence outside Git; no model-turn or Git-operation caps; secrets and oracle data remain host-only **Scale/Scope**: One attempt, three agents, one shared repository, six stages per agent, one final reviewer selection **Puzzle Contribution**: Delivers differing private evidence over time, including a shared partial re-key that can challenge prior beliefs without requesting a belief update **Agent Instructions & Tools**: Concise shared objective and peer context; local shell/code access; ordinary Git; target-excluded reference corpus; aggregate private checker; wait-for-activity; no roles, algorithms, turns, checkpoints, or prescribed artifacts **Environmental Constraints**: Evidence visibility follows a fixed monotonic schedule; individual cumulative model-token budgets and one global wall-time limit are enforced; prepared plaintext, keys, peer-private evidence, checker internals, provider credentials, and host controls stay outside agent workspaces **Observable Outcomes**: Raw model/tool transcripts, lifecycle transitions, stage releases, checker aggregates, Git activity, frozen workspaces, reviewer command/output choice, reconstruction score, and narrow post-run raw-overlap findings **Determinism Claim**: Puzzle bytes, stage schedule offsets, changed mappings, checker aggregates, fixture behavior, overlap observations, and final scores reproduce from recorded configuration and seeds; live model decisions and timing do not

## Constitution Check

_GATE: Passed before Phase 0 research and re-checked after Phase 1 design._

- **Puzzle behavior before process**: PASS. The prompt states only the objective, concurrent peers, available tools, and the requested raw-sharing restraint.
- **Environmental constraints, not workflow**: PASS. Staging and cutoffs are clock- and usage-driven; no turn, checkpoint, Git, or artifact sequence is required.
- **Minimal reproducible mechanics**: PASS. The active path contains only build, run, check, observe, freeze, and evaluate mechanics needed by this experiment.
- **Observe outcomes honestly**: PASS. Model-created failures and workarounds remain outcomes, while infrastructure failures receive separate records.
- **Voluntary native collaboration**: PASS. Agents are explicitly told to collaborate through ordinary Git, but Git use and collaboration form are not validity requirements.

## Project Structure

### Documentation (this feature)

```text
specs/006-behavior-neutral-runner/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── tools.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/puzzle-runner/
├── package.json
├── tsconfig.json
├── src/
│   ├── activity.ts
│   ├── adapters.ts
│   ├── config.ts
│   ├── evaluator.ts
│   ├── git.ts
│   ├── index.ts
│   ├── observations.ts
│   ├── prompt.ts
│   ├── session.ts
│   ├── supervisor.ts
│   └── tools.ts
└── tests/

python/src/palimpsest/puzzle/
├── __init__.py
├── build.py
├── checker.py
├── model.py
├── overlap.py
└── score.py

python/tests/puzzle/
├── test_build.py
├── test_checker.py
├── test_overlap.py
└── test_score.py

tools/puzzle/
├── build.ts
├── evaluate.ts
├── offline.ts
└── run.ts

tests/puzzle/
├── cli.test.ts
├── evaluator.test.ts
├── git.test.ts
├── prompt.test.ts
├── supervisor.test.ts
└── tools.test.ts
```

**Structure Decision**: Put orchestration and host tool execution in a new `@palimpsest/puzzle-runner` TypeScript package, where asynchronous processes, Git, clocks, and provider adapters fit the existing runtime. Put deterministic puzzle construction and token-level evaluation in `palimpsest.puzzle`, reusing the existing generation and revision primitives without inheriting gate authorization. Expose only three canonical operator commands under `tools/puzzle`. Keep earlier numbered specs and their historical implementation readable, but remove their hardened harness commands and terminology from the active project surface once the new path passes verification.

## Design

### Build

`puzzle:build` prepares one attempt from recorded seeds and source inputs. Each agent receives six immutable stage files in a host-private source directory. The first three stages use the base substitution and the last three use a single deterministic partial re-key shared across all three streams. Each stream contains enough useful pre-transition evidence for a rule to form and enough contradictory post-transition evidence for continued use of the stale rule to matter. The prompt and tool results do not announce the transition. A public complete ciphertext is prepared separately for final evaluation; plaintext, both keys, and checker truth remain in the host-only oracle directory.

### Run

`puzzle:run` creates a bare shared repository plus one clone and one private evidence directory per agent. A supervisor starts exactly three independent persistent sessions through an `AgentAdapter`. Each response may request tools, wait, or return a final answer. Tool cycles are unbounded except by cumulative model-token and global wall-time limits. A monotonic stage clock publishes private files independently of session state. Stage publication and shared Git head changes emit activity events that wake only waiting sessions.

The production adapter uses the OpenAI Responses API while keeping provider state behind the adapter boundary. The deterministic fixture adapter drives offline lifecycle, Git, checker, raw-sharing, and failure scenarios without network access.

### Check

The private checker reads a model-selected candidate and compares it only with truth corresponding to that agent's released stages. It reports `matchedWords`, `totalWords`, `coverage`, and `accuracy`, or a plain execution error. Missing and extra tokens count as incorrect; no correct word, expected word, or mismatch position leaves the host boundary.

### Freeze And Evaluate

At wall-time or after all sessions terminate, the supervisor stops active work and copies the repository and workspaces to a frozen attempt snapshot. `puzzle:evaluate` records a reviewer's inferred command and output path before executing the command against the complete ciphertext. It reports `scored`, `not-runnable`, `no-output`, or `execution-error`; when output exists, deterministic scoring tolerates unequal token counts and preserves the computed score.

### Observe

An append-only attempt trace records configuration, stage releases, session state, token use, model/tool events, checker aggregates, Git head changes, termination, freezing, reviewer selection, execution, and score. This chronology lets a reviewer compare contradictory evidence arrival with continued rule use, peer communication, and later code or finding changes without requiring agents to publish a canonical hypothesis. A post-run observer reports only obvious exact or normalized long overlap between committed content and private raw text. Findings never block Git, warn agents, alter scores, or invalidate attempts.

## Migration

1. Add the behavior-neutral puzzle library, runner package, tools, and offline tests alongside the historical gate code.
2. Make `puzzle:build`, `puzzle:run`, `puzzle:evaluate`, and `puzzle:offline` the canonical package scripts and update current-state documentation.
3. Remove active `harness:*` scripts and the obsolete harness runtime/tests after the new offline path proves equivalent coverage for build, run, freeze, and evaluation. Preserve earlier numbered specifications and Git history as the record of the retired design.
4. Keep shared generation/cipher primitives and generic solver execution where their behavior matches this plan; do not route the new runner through predeclaration, promotion, metered gateway, publication slots, replay, or gate completion.

## Verification Strategy

- Python unit and property tests prove six-stage geometry, shared transition invariants, checker non-disclosure, unequal-length scoring, and overlap observation.
- TypeScript unit tests prove prompt neutrality, non-disclosure of the re-key, ordinary Git behavior, independent lifecycle transitions, token/wall cutoffs, wake semantics, reviewer statuses, and a chronology that exposes stale-rule persistence and voluntary revision.
- A fresh `puzzle:offline` test builds, runs, freezes, evaluates, and explains one attempt without network or external model access.
- Repository verification runs formatting, linting, type checking, TypeScript tests, Python tests, cross-runtime checks retained by shared code, `git diff --check`, and the documented quickstart.

## Complexity Tracking

No constitution violations require justification.
