# Implementation Plan: Simple Research Verification

**Branch**: `012-simple-research-ci` | **Date**: 2026-07-28 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `specs/012-simple-research-ci/spec.md`

## Summary

Replace the heavyweight required pull-request gate with a mechanical advisory Linux smoke check, and move complete behavioral verification to one explicit `pnpm preflight` immediately before a live experiment that spends money or may support findings. CI installs locked dependencies, checks formatting and lint, compiles TypeScript, and builds the sandbox image without running test suites. Preflight invalidates stale authorization, requires a clean commit, runs the complete suite plus a fresh offline fixture, and atomically publishes one receipt. A provider-backed run validates that receipt against the current commit and inspected sandbox before model sessions begin, then copies it into the attempt artifacts.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: Node standard library, pnpm 10.14.0, uv 0.11.14, Docker Engine/Desktop, ordinary host Git, existing digest-labelled sandbox **Storage**: Ignored local `artifacts/preflight.json`, a temporary offline fixture, and `preflight.json` copied into live attempt roots **Testing**: Vitest 4.1.10, pytest 9.1.1, Ruff, Oxlint, Oxfmt, retained real Git/Docker integration tests, and the deterministic offline fixture **Target Platform**: Advisory CI on Ubuntu 24.04; local preflight on supported macOS or Linux hosts with Docker **Project Type**: Local dual-runtime research CLI **Performance Goals**: Advisory CI runs only mechanical checks and a Docker image build; the behavioral suite runs only at the experiment/publication risk boundary **Constraints**: No release environments, matrices, remote attestations, signed receipts, receipt history, generalized workflow engine, or compatibility layer **Scale/Scope**: One workflow, two package scripts, one TypeScript runtime owner, one small receipt, one live-run guard, focused tests, and active documentation **Puzzle Contribution**: No agent-visible puzzle behavior changes **Agent Instructions & Tools**: Prompts, tools, voluntary unmetered Git, scientific libraries, and collaboration freedom remain unchanged **Environmental Constraints**: The command sandbox policy and immutable image identity remain authoritative; host Git and Docker are accepted through behavior rather than exact patch equality **Observable Outcomes**: Existing traces, scores, workspaces, overlap, and reviewer records remain unchanged; live attempt roots additionally retain the matching preflight receipt **Determinism Claim**: Fixed scientific inputs still reproduce deterministic mechanics and scoring. The receipt identifies tested source and sandbox but does not claim stochastic model behavior is reproducible.

## Constitution Check

_GATE: Passed before Phase 0 research and re-checked after Phase 1 design._

- **Puzzle behavior before process - PASS**: No prompt, tool, role, turn, checkpoint, or agent workflow changes.
- **Environmental constraints, not workflow - PASS**: Preflight constrains only the operator before live research; it does not affect model choices.
- **Minimal reproducible mechanics - PASS**: One local receipt contains only the commit and sandbox identity needed to connect findings to tested code.
- **Observe outcomes honestly - PASS**: Advisory failures and preflight failures remain infrastructure evidence, not model outcomes.
- **Voluntary native collaboration - PASS**: Git use inside the experiment remains voluntary and unmetered.
- **Risk-aligned verification - PASS**: CI is fast and advisory; the complete sandbox and fixture gate occurs immediately before consequential live research.

## Project Structure

### Documentation (this feature)

```text
specs/012-simple-research-ci/
├── checklists/
│   └── requirements.md
├── contracts/
│   └── research-preflight.md
├── data-model.md
├── plan.md
├── quickstart.md
├── research.md
├── spec.md
└── tasks.md
```

### Source Code (repository root)

```text
.github/workflows/verify.yml       # becomes the fast advisory check
.tool-versions                     # language/package tools only
package.json                       # check and preflight scripts
tools/verify-versions.ts           # exact language/package declarations only
src/
├── cli.ts                         # routes preflight
├── preflight.ts                   # receipt, full preflight, and live-run validation
└── run.ts                         # gates provider-backed runs and copies receipts
tests/
├── integration/verification.test.ts
└── puzzle/
    ├── offline.test.ts
    └── sandbox.integration.test.ts
```

**Structure Decision**: Keep the existing root application and add only `src/preflight.ts`. It owns both the small receipt and its operator lifecycle because they change together and have no reuse boundary requiring another directory or service.

## Phase 0 Decisions

The research in [research.md](research.md) resolves all technical choices. There are no remaining clarification markers or constitution violations.

## Phase 1 Design

### Advisory Check

The workflow runs for pull requests and pushes to `main`, installs locked Node and Python dependencies, executes `pnpm check`, and builds the sandbox image. `check` retains exact Node/pnpm/Python/uv declaration checks, formatting, lint, and the TypeScript build. CI runs no TypeScript, Python, real-container behavior, or offline fixture test suite.

The workflow remains visibly red on failure. It is advisory because branch protection requires no status checks, not because failures are hidden.

### Full Preflight

`pnpm preflight` routes through `src/cli.ts` and performs this fail-closed sequence:

1. Require a clean committed checkout and capture `HEAD`.
2. Remove the prior canonical receipt.
3. Rebuild the sandbox and retain its immutable identity.
4. Run the existing complete `pnpm verify` suite.
5. Execute a fresh deterministic offline fixture in a temporary directory.
6. Confirm the fixture scored with the rebuilt sandbox.
7. Re-check the same clean commit and current sandbox identity.
8. Atomically publish `artifacts/preflight.json`.

Any failure leaves no successful canonical receipt.

### Live-Run Authorization

Fixture runs remain receipt-free. Before a provider-backed run can begin a model session or make a provider request, `src/run.ts` requires:

- a valid canonical receipt;
- a still-clean worktree at the receipt's commit;
- the current inspected sandbox identity to match the receipt exactly.

After `runAttempt` exclusively creates the attempt root, it atomically copies the validated receipt to `preflight.json` before model sessions start. The attempt's existing `attempt.json` independently records the actual sandbox identity and policy.

### Tool Versions

`.tool-versions` and `tools/verify-versions.ts` retain exact versions for Node, pnpm, Python, and uv. Host Git and Docker patch versions are removed from equality checks:

- real Git tests prove the required repository behavior;
- sandbox build, containment, cleanup, and offline tests prove Docker behavior;
- the sandbox image ID and source digest identify the agent-visible experimental environment.

## Complexity Tracking

No constitution violations or additional systems are required.
