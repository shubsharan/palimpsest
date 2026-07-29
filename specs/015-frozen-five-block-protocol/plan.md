# Implementation Plan: Frozen Five-Block Protocol

**Branch**: `feature/015-frozen-five-block-protocol` | **Date**: 2026-07-28 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `specs/015-frozen-five-block-protocol/spec.md`

## Summary

Replace the transitional schema-version-1 run list with one strict schema-version-2 five-block study manifest. Add a small local study coordinator that prepares all deterministic builds, publishes one immutable calibration design receipt, expands the exact four-cell calibration and sixteen-cell validation matrices, reserves each launch before opening sessions, and indexes only durable attempts. Keep individual attempts, native Git topology, optional overlap, and explicit evaluation unchanged. Infrastructure replacement is an explicit appended attempt for a cited frozen session-infrastructure failure; there is no retry engine, result selection, aggregation, service, or database.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; existing Python 3.12.4 puzzle construction, checking, scoring, and overlap **Primary Dependencies**: Node standard library, Ajv, YAML, existing direct provider adapters, Git CLI, current command sandbox **Storage**: Strict JSON/YAML and immutable local directories under one operator-selected study root **Testing**: Vitest 4.1.10 with fixture adapters and fake monotonic clocks; existing pytest, Ruff, Oxlint, Oxfmt; one retained real Docker/offline smoke **Target Platform**: Local macOS or Linux with Git; Docker for the command sandbox and receipt-bound preflight **Project Type**: Local dual-runtime research CLI **Performance Goals**: Expand and execute twenty provider-free cells sequentially while retaining three concurrent sessions per attempt **Constraints**: Exactly five registered blocks, three fixed agent assignments, four canonical conditions, fixed release schedule, no live provider calls in acceptance, no automatic retry, no post-hoc merge, no compatibility layer **Scale/Scope**: One manifest, one study coordinator, one design receipt, two phase summaries, twenty primary cells, and rare explicit replacements **Puzzle Contribution**: Freezes a balanced sequence of communication/evidence treatments without exposing phase, order, rubric, lineage, or other cells to agents **Agent Instructions & Tools**: Feature 014 prompts and tools remain behavior-neutral; only agent ID, communication mode, and the resolved token budget vary **Environmental Constraints**: Fixed six-release schedule and 60-minute cutoff, native condition Git topology, no public sandbox network, no provider credentials in model workspaces, and clean receipt-bound preflight before provider sessions **Observable Outcomes**: Immutable study design, cell order, treatment, session traces, native Git, checker/scoring records, resource authorization, infrastructure classification, replacement lineage, optional overlap, and explicit evaluation **Determinism Claim**: Manifest resolution, block construction, matrix expansion, prompt templates, design and protocol digests, accounting, artifact validation, checker, scoring, and replacement eligibility are deterministic; model behavior and concurrent activity are not

## Constitution Check

- **Puzzle behavior before process - PASS**: Study phase, block order, receipt, accounting, rubric, and replacement rules are operator-only. Agent prompts retain only identity, objective, environment, limits, and tools.
- **Environmental constraints, not workflow - PASS**: Conditions change native communication/evidence availability. The runner schedules attempts sequentially but does not prescribe agent roles, algorithms, Git operations, checkpoints, or coordination.
- **Minimal reproducible mechanics - PASS**: One TypeScript study module, one strict manifest, one receipt, and one phase record cover the study. No service, account, database, dashboard, plugin, generalized workflow engine, or automated reviewer is added.
- **Observe outcomes honestly - PASS**: Unsuccessful reconstruction, early stop, no Git use, conflict, low score, and communication choices remain model outcomes. Only frozen session-infrastructure failures are replaceable.
- **Condition-defined native collaboration - PASS**: Feature 014's shared/isolated Git and activity visibility remain the treatment mechanism; model assignment, schedule, tools, evidence, and prompt template remain paired.
- **Risk-aligned verification - PASS**: Provider-free fixtures exercise all twenty cells. Paid or findings-bearing execution still requires the existing clean receipt-bound preflight.

Post-design re-check: PASS. The launch reservation closes the only implicit-retry gap without creating orchestration machinery; the design receipt and phase summaries are ordinary strict local artifacts; replacement is a separate cited command.

## Project Structure

### Documentation

```text
specs/015-frozen-five-block-protocol/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── study-protocol.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
src/
├── config.ts
├── config.test.ts
├── study.ts
├── study.test.ts
├── artifacts.ts
├── artifacts.test.ts
├── experiment.ts
├── experiment.test.ts
├── run.ts
├── run.test.ts
├── prompt.ts
└── prompt.test.ts

tests/puzzle/
├── cli.test.ts
└── offline.test.ts

experiments/
├── config.yaml
├── schema.json
└── behavior-rubric.md
```

**Structure Decision**: Add only `src/study.ts` as a genuine ownership boundary for study expansion, receipt validation, phase state, launch reservation, accounting, and explicit replacement. Keep one-attempt execution in `run.ts`, artifact codecs in `artifacts.ts`, manifest decoding in `config.ts`, and CLI wiring in `experiment.ts`.

## Phase 0 Decisions

See [research.md](research.md). All manifest fields, digests, accounting units, prompt binding, failure eligibility, crash recovery, and provider-call ordering are resolved.

## Phase 1 Design

### Strict Manifest And Matrix

Schema version 2 contains exactly five registered blocks, the fixed three-agent model assignment, current provider/model declarations, immutable schedule, budgets in tokens and integer USD cents, fixed calibration/validation orders, scoring and reviewer boundaries, rubric identity/digest, two adjustable field paths, and one failure policy. Unknown fields and schema version 1 are rejected.

Calibration expands `calibration-theron-ware` as `CS CR IR IS`. Validation pairs its four registered blocks with:

1. `CS CR IR IS`
2. `CR IS CS IR`
3. `IS IR CR CS`
4. `IR CS IS CR`

Every primary launch authorizes `3 * tokenBudgetPerAgent` tokens and `perAttemptMonetaryCeilingCents`. Before the first launch, all twenty primary cells must fit the immutable study-wide ceilings. Before every primary or replacement launch, cumulative authorized maxima plus the next launch must fit. Actual provider usage is recorded separately and never weakens authorization accounting.

### Receipt And Digests

Calibration validates the credential-free manifest, builds all five blocks once, verifies their manifests, and exclusively publishes `design.json` before resolving credentials or opening a provider session. The receipt stores:

- the complete manifest digest;
- an immutable-manifest digest that omits only the two declared adjustable values;
- a design digest over the immutable manifest projection, raw build-manifest digests, rubric bytes, prompt templates, scoring/reviewer boundary, failure rules, and sandbox policy;
- block IDs, build identities, raw build-manifest digests, and construction/manipulation metadata;
- the fixed model assignment and condition orders;
- prompt templates with a token-budget placeholder plus baseline resolved prompt snapshots.

Attempt protocol snapshots remain agent-visible treatment inputs only. Feature 015 adds operator-only study provenance to attempt summaries without inserting phase, order, rubric, receipt, replacement, or other-cell information into prompts or protocol digests.

### Local Phase State

Each phase has one strict `phase.json` written atomically after its prerequisites pass. It records the ordered plan, manifest/design digests, adjustments, resource accounting, durable attempts, launch reservations, completion, and failure.

Before adapter/session work, the coordinator appends one launch reservation for the selected cell. After a strict attempt is durably indexed, the reservation becomes resolved. A crash or infrastructure failure before durable freeze leaves an unresolved reservation and blocks further execution in that study root. This prevents a resume command from silently relaunching work that may have reached a provider but lacks a valid scientific artifact.

Validation requires the same study root, completed calibration, intact receipt-bound builds, matching immutable manifest/design identity, and one atomic adjustment record before the first validation reservation. Only `budgets.tokenBudgetPerAgent` and `budgets.perAttemptMonetaryCeilingCents` may differ, and the recalculated twenty-primary-cell authorization must still fit the frozen totals.

### Failure And Replacement Boundary

Only a strict frozen attempt whose session result is classified `session-infrastructure-error` is eligible. Model outcomes, command use, Git conflicts, checker results, score, early completion, no commits, overlap errors, evaluation errors, and failures before durable attempt publication are not.

An eligible attempt is indexed unchanged and stops the phase nonzero. `--replace <attempt-id>` is the only replacement surface. It validates the cited attempt, absence of prior replacement, treatment/design/budget identity, and remaining ceilings before reserving and appending exactly one new attempt with `replacementOfAttemptId`. A failed replacement is itself preserved and may be cited once if it independently meets the same frozen classification.

### Provider And Evaluation Boundaries

Provider-backed launches verify the current clean source/sandbox preflight before credential resolution, adapter construction, or session opening. Provider-free tests inject fixture adapters and fake clocks. Phase completion means all planned cells have a successful durable primary or eligible replacement; it does not run overlap, select a workspace, evaluate, apply the rubric, aggregate outcomes, or make a benchmark claim.

## Complexity Tracking

No Constitution violations or exceptions.
