# Implementation Plan: Optional Team Channel

**Branch**: `016-optional-team-channel` | **Date**: 2026-07-29 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `specs/016-optional-team-channel/spec.md`

## Summary

Add one manifest-declared `enabled`/`disabled` team-channel mode. When enabled, shared conditions receive one in-memory append-only room with post and paged-read tools; accepted posts wake condition-visible activity and are written once to the canonical trace. Disabled shared conditions retain the existing Git-only prompt and tools, and isolated conditions never receive the room. The mode is bound through schema-v3 configuration, design receipts, prompt snapshots, protocol-v2 attempt identity, and tests. Git remains the only solver integration and grading boundary.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 puzzle/scoring remains unchanged **Primary Dependencies**: Node standard library, Ajv/YAML configuration, existing activity bus, model tool interface, trace writer, Git runtime, and command sandbox **Storage**: Strict YAML/JSON configuration and existing JSONL/readable traces; no service or database **Testing**: Vitest 4.1.10 unit/integration tests, existing pytest/Ruff/Oxlint/Oxfmt, provider-free fixture and real-container preflight **Target Platform**: Local macOS or Linux; Docker remains limited to existing agent/evaluation commands **Project Type**: Local dual-runtime research CLI **Performance Goals**: Deliver a post synchronously to all eligible peers; page reads at 20 messages; add no polling process or external I/O **Constraints**: Exactly three agents; one public room; 4,000-character message maximum; no private messages; no channel in isolated conditions; no live provider call in acceptance **Scale/Scope**: One mode field, one small in-memory channel, two agent tools, one activity kind, one trace event, prompt/protocol bindings, and focused documentation/tests **Puzzle Contribution**: Lets shared-condition agents discuss strategy directly while preserving Git-only comparison runs and isolated peer non-observability **Agent Instructions & Tools**: Enabled shared prompts disclose `post_team_message` and `read_team_messages`; no roles, turns, required messages, or consensus; `origin/main:solver.py` remains the only checked/graded artifact **Environmental Constraints**: Messages are attempt-local and public to all shared peers; private evidence, schedule, Git, sandbox, secrets, network, token, and cutoff boundaries remain unchanged **Observable Outcomes**: Mode, posts, reads, wake activity, model/tool responses, Git/checker activity, usage, termination, and score remain traceable **Determinism Claim**: Fixed mode and tool calls deterministically order and deliver accepted posts; concurrent model decisions and post interleavings remain stochastic

## Constitution Check

- **Puzzle behavior before process - PASS**: The prompt describes an available discussion tool without recommending a solve strategy, assigning roles, or requiring messages.
- **Environmental constraints, not workflow - PASS**: Channel availability is declared before model work and independent of behavior; no turn, checkpoint, response, or coordination sequence is imposed.
- **Minimal reproducible mechanics - PASS**: One in-memory room reuses the existing tool, activity, and trace boundaries. No service, account, database, broker, moderator, or summary layer is added.
- **Observe outcomes honestly - PASS**: Silence, ignored messages, disagreement, raw sharing, duplication, and failed collaboration remain model outcomes.
- **Condition-defined native collaboration - PASS**: The optional room is exposed only in shared conditions; isolated conditions retain private Git and no peer evidence or activity. The solver scaffold and pushed-main grading boundary are unchanged.
- **Risk-aligned verification - PASS**: Provider-free tests cover the channel and full preflight remains required before the next paid run.

Post-design re-check: PASS. The design binds the channel mode in the immutable manifest and attempt protocol, exposes only two direct tools when eligible, writes accepted posts to the existing trace, and preserves every non-communication puzzle and grading input.

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
│   └── team-channel.md
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
├── team-channel.ts
├── team-channel.test.ts
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
├── run.ts
├── run.test.ts
├── study.ts
├── study.test.ts
├── configured-run.ts
├── offline.ts
└── fixture.ts

tests/puzzle/
├── experiment.test.ts
└── offline.test.ts
```

**Structure Decision**: Keep message ordering and validation in one small `team-channel.ts` value object. Reuse `ActivityBus` for wakeups, `createAgentTools` for exposure, `run.ts` for attempt ownership and trace publication, and the existing manifest/protocol/receipt codecs for provenance. Add no transport or persistence subsystem.

## Complexity Tracking

No Constitution violations or exceptions.
