# Implementation Plan: Optional Team Channel

**Branch**: `016-optional-team-channel` | **Date**: 2026-07-29 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `specs/016-optional-team-channel/spec.md`

## Summary

Add one manifest-declared `enabled`/`disabled` team-channel mode. When enabled, shared conditions receive one in-memory append-only room with post and paged-read tools; accepted posts wake condition-visible activity and are written once to the canonical trace. Disabled shared conditions retain the existing Git-only prompt and tools, and isolated conditions never receive the room. The mode is bound through schema-v3 configuration, design receipts, prompt snapshots, protocol-v2 attempt identity, and tests. Git remains the only solver integration boundary. One serialized attempt runtime owns released-stage, team-message, activity, Git-change, and shutdown state and returns only immutable per-agent views. One complete published-solver operation fetches literal `refs/heads/main`, materializes and executes its pinned Git-free tree, evaluates valid output, cleans temporary state, and only then returns a typed outcome for checker or evaluation publication.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 puzzle/scoring remains unchanged **Primary Dependencies**: Node standard library, Ajv/YAML configuration, existing activity bus, model tool interface, trace writer, Git runtime, and command sandbox **Storage**: Strict YAML/JSON configuration, temporary Git-free submission trees, and existing JSONL/readable traces; no service or database **Testing**: Vitest 4.1.10 unit/integration tests, deterministic lifecycle barriers, adversarial Git/path probes, existing pytest/Ruff/Oxlint/Oxfmt, provider-free fixture and real-container preflight **Target Platform**: Local macOS or Linux; Docker remains limited to existing agent and short-lived solver commands **Project Type**: Local dual-runtime research CLI **Performance Goals**: Serialize treatment-state commits without blocking model work; deliver a post synchronously to all eligible peers; page reads at 20 messages; materialize and execute one published tree per checker/evaluation call without external I/O **Constraints**: Exactly three agents; one public room; 4,000-character message maximum; no private messages; no channel in isolated conditions; no mutable attempt state across asynchronous tool boundaries; no live provider call in acceptance; solver output limited to 16 MiB **Scale/Scope**: One mode field, one small in-memory attempt runtime, two agent tools, one activity kind, one trace event, one complete published-solver runner, prompt/protocol bindings, and focused documentation/tests **Puzzle Contribution**: Lets shared-condition agents discuss strategy directly while preserving Git-only comparison runs, isolated peer non-observability, and reproducible published-main scoring **Agent Instructions & Tools**: Enabled shared prompts disclose `post_team_message` and `read_team_messages`; no roles, turns, required messages, or consensus; `origin/main:solver.py` remains the only checked/graded entrypoint **Environmental Constraints**: Messages are attempt-local and public to all shared peers; checker/evaluation sandboxes receive only an exported read-only main tree, assigned ciphertext, and contained output; private evidence, references, Git metadata, secrets, network, token, and cutoff boundaries remain unavailable or unchanged **Observable Outcomes**: Mode, posts, reads, wake activity, model/tool responses, Git/checker activity, captured main commit, usage, termination, and score remain traceable **Determinism Claim**: Fixed mode and serialized runtime calls deterministically order and deliver accepted treatment-state events; a captured main commit deterministically fixes submitted code; concurrent model decisions and call interleavings remain stochastic

## Constitution Check

- **Puzzle behavior before process - PASS**: The prompt describes an available discussion tool without recommending a solve strategy, assigning roles, or requiring messages.
- **Environmental constraints, not workflow - PASS**: Channel availability is declared before model work and independent of behavior; no turn, checkpoint, response, or coordination sequence is imposed.
- **Minimal reproducible mechanics - PASS**: One in-memory room reuses the existing tool, activity, and trace boundaries. No service, account, database, broker, moderator, or summary layer is added.
- **Observe outcomes honestly - PASS**: Silence, ignored messages, disagreement, raw sharing, duplication, and failed collaboration remain model outcomes.
- **Condition-defined native collaboration - PASS**: The optional room is exposed only in shared conditions; isolated conditions retain private Git and no peer evidence or activity. The solver scaffold and pushed-main grading boundary are unchanged.
- **Trusted published-main grading - PASS**: One host-owned snapshot runner implements the constitution's captured-main requirement and replaces checker/evaluator access to agent-controlled files without prescribing model behavior.
- **Risk-aligned verification - PASS**: Provider-free tests cover the channel and full preflight remains required before the next paid run.

Post-design re-check: PASS. The design binds the channel mode in the immutable manifest and attempt protocol, exposes only two direct tools when eligible, writes accepted posts to the existing trace, and preserves every non-communication puzzle input. The shared snapshot runner makes the existing published-main grading claim reproducible while adding no service or workflow constraint.

## Project Structure

### Documentation

```text
specs/016-optional-team-channel/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── team-channel.md
│   └── published-solver.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
experiments/
├── config.yaml
└── schema.json

src/
├── attempt-runtime.ts
├── attempt-runtime.test.ts
├── published-solver.ts
├── published-solver.test.ts
├── team-channel.ts
├── activity.ts
├── activity.test.ts
├── tools.ts
├── tools.test.ts
├── prompt.ts
├── prompt.test.ts
├── config.ts
├── config.test.ts
├── artifacts.ts
├── artifacts.test.ts
├── evaluate.ts
├── evaluate.test.ts
├── sandbox/
│   ├── contracts.ts
│   ├── docker.ts
│   └── workspace.ts
├── run.ts
├── run.test.ts
├── study.ts
├── study.test.ts
├── configured-run.ts
├── offline.ts
└── fixture.ts

tests/puzzle/
├── experiment.test.ts
├── offline.test.ts
└── sandbox.integration.test.ts
```

**Structure Decision**: Put all mutable treatment-state ownership in one small serialized `attempt-runtime.ts`. It commits stage, message, and Git events through the existing trace writer, synchronously updates private activity/message/release projections, returns copied per-agent handles, and orders closure after queued work. Keep message value contracts in `team-channel.ts`, tool adaptation in `tools.ts`, and orchestration in `run.ts`. Put deadline-bound exact-main capture, Git-free materialization, isolated execution, output validation, trusted evaluation, and cleanup-before-return in one `published-solver.ts` operation used by both checking and evaluation. Represent releases as ordered host-owned records and serialize sealed sources in `released-stage.ts`. Add no transport, replay system, service, database, or permanent submission mirror.

## Complexity Tracking

No Constitution violations or exceptions.
