# Implementation Plan: Configurable Run Controls

**Branch**: `019-configurable-run-controls` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/019-configurable-run-controls/spec.md`

## Summary

Restore the experiment manifest as the real control surface for release timing, wall time, token limiting, and monetary authorization. Validate values through safe invariants, then copy the resolved controls through prompts, sessions, protocol digests, design receipts, launch reservations, traces, and attempt artifacts so each run is frozen independently. Add the provider-safe returned reasoning-summary subset from Feature 018 without importing its fixed one-hour protocol or historical live-run state.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: AI SDK 7.0.38, provider packages, Ajv 8.20.0, YAML 2.9.0, Node standard library, Docker, Git **Storage**: Checked-in YAML/JSON Schema; generated receipts, phase summaries, attempts, traces, frozen Git trees, and evaluation artifacts **Testing**: Vitest 4.1.10, pytest 9.1.1, fake clocks and adapters, mocked AI SDK models, Git/Docker integration tests **Target Platform**: Local macOS or Linux host with Docker **Project Type**: Local dual-runtime research CLI **Performance Goals**: Reject invalid controls before build/provider side effects; add no polling or service overhead **Constraints**: No hidden retry, provider fallback, credential retention, workflow prescription, or paid verification in the implementation suite **Scale/Scope**: Three agents and six constructed stages; multiple safe clock profiles; enabled or disabled cumulative token limiting; one sequential twenty-cell study matrix plus explicit replacements **Puzzle Contribution**: Lets a researcher change environmental opportunity between declared runs without changing puzzle-solving workflow or runner source **Agent Instructions & Tools**: Preserve objective, team identity, condition-defined communication/Git, checker, activity waiting, and published-main solver boundary; disclose resolved resource limits only **Environmental Constraints**: Manifest-selected releases, wall cutoff, token policy, monetary ceilings, model settings, sandbox, and secret boundaries **Observable Outcomes**: Resolved controls, usage, termination, safe returned summary evidence, stages, tools, Git, frozen work, selection, and score **Determinism Claim**: A resolved manifest deterministically defines controls, prompts, authorization, and artifact identity; model behavior and provider serving remain stochastic

## Constitution Check

_GATE: Passed before research and passed again after design._

- **Puzzle behavior before process — PASS**: The change exposes environmental inputs and does not prescribe algorithms, roles, turns, checkpoints, files, or Git actions.
- **Environmental constraints, not workflow — PASS**: Controls are selected before launch and remain independent of model behavior.
- **Minimal reproducible mechanics — PASS**: Existing YAML, validation, session, receipt, and artifact paths are generalized; no new service or orchestration layer is added.
- **Observe outcomes honestly — PASS**: Enabled and disabled token policies, voluntary completion, and infrastructure failures remain explicit outcomes.
- **Condition-defined native collaboration — PASS**: Communication treatments and the published-main grading boundary do not change.
- **Risk-aligned verification — PASS**: Provider-free checks remain advisory; paid work still requires a clean receipt-bound preflight.

## Project Structure

### Documentation (this feature)

```text
specs/019-configurable-run-controls/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── run-controls.md
│   └── returned-reasoning-summary.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
experiments/
├── config.yaml
└── schema.json

src/
├── artifacts.ts
├── condition.ts
├── config.ts
├── model.ts
├── prompt.ts
├── provider.ts
├── run.ts
├── session.ts
├── study.ts
└── corresponding tests and helpers

tests/
├── fixtures/config/
└── puzzle and integration tests
```

**Structure Decision**: Keep the flat TypeScript runner and existing Python builder. Configuration resolution stays in `src/config.ts`; runtime enforcement stays in `src/session.ts` and `src/run.ts`; durable validation stays in `src/artifacts.ts` and `src/study.ts`. Provider-specific evidence extraction stays isolated in `src/provider.ts`.

## Design

### Run-Control Resolution

`experiments/schema.json` permits six safe non-negative release offsets rather than one literal array. `src/config.ts` enforces relationship rules: the first offset is zero, offsets strictly increase, and cutoff is later than the final offset. The run decoder repeats the same invariant at its trust boundary and also confirms that the offset count matches the selected build's stage count.

`budgets.tokenBudgetPerAgent` is `number | null`. A positive number enables the existing cumulative session cutoff; `null` disables only that cutoff. `budgets.totalTokenCeiling` mirrors the policy: a positive total is required when limiting is enabled and `null` is required when it is disabled. Monetary ceilings remain non-null and are always checked.

The checked-in manifest remains an example with the current one-hour schedule and enabled 500,000-token limit. Tests use additional valid profiles without changing source constants or schema versions.

### Frozen Evidence

The resolved schedule and token policy flow through prompt bindings, protocol snapshots, attempt summaries, design receipts, reservations, adjustments, and phase accounting. Artifact schema versions advance because `null` becomes a meaningful policy state. Decoders validate invariants rather than comparing against `condition.ts` constants.

Study totals use nullable token authorization. When limiting is enabled, existing matrix and replacement headroom checks apply. When disabled, token authorization fields and cumulative authorized-token totals are `null`; actual provider usage remains numeric and observable.

`condition.ts` no longer owns an accepted global clock. It may retain an example profile only if callers do not use it for validation or runtime selection. Production standalone and study paths receive resolved controls explicitly.

### Returned Reasoning Summary Evidence

The generic Feature 018 subset is reapplied on top of `main`: model turns may carry normalized reasoning text plus a discriminated returned-summary record. Only OpenAI Responses middleware reads `generated.response.body`, extracts reasoning item IDs and ordered `summary_text` entries, then discards the body. A missing body differs from a captured empty list. Other providers omit this OpenAI-specific field.

### Verification

Tests cover multiple schedules, invalid ordering/cutoff relationships, enabled and disabled token policy, artifact round trips, receipt/reservation drift, provider extraction and exclusion, and trace propagation. Full verification must be run without provider credentials. No preflight or live provider run is part of this feature because those validate a particular committed run, not the generic configuration capability.

## Complexity Tracking

No constitution exception is required. Nullable token policy adds one explicit state to existing configuration and artifact contracts rather than a parallel runtime path.
