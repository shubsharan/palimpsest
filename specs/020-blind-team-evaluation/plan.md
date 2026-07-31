# Implementation Plan: Blind Calibration and Team-Level Evaluation

**Branch**: `020-blind-team-evaluation` | **Date**: 2026-07-31 | **Spec**: [spec.md](spec.md) **Input**: Feature specification from `/specs/020-blind-team-evaluation/spec.md`

## Summary

Make checking blind by replacing oracle-backed partial scoring with execution, output-validity, and plaintext-independent token coverage. Replace reviewer workspace selection with deterministic post-freeze evaluation of every condition-canonical `main` ref, adding origin diagnostics, realized-team-product status, a collective ceiling, and a nullable integration gap. Split build validity into evidence and control tiers, then make parsing, bounded scanning, phase validation, sealing, and atomic publication one command for any local UTF-8 prose source. Advance the strict protocol records, expand the trace-grounded behavior rubric, verify the exact committed implementation provider-free, then run one four-cell GPT-5.6-sol calibration and stop before validation.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4 **Primary Dependencies**: AI SDK 7.0.38, provider packages, Ajv 8.20.0, YAML 2.9.0, Node standard library, Docker, Git **Storage**: Checked-in YAML/JSON/prose and generated local build, receipt, attempt, trace, evaluation, diagnostic, behavior-review, and preflight files **Testing**: Vitest 4.1.10, pytest 9.1.1, fake clocks and providers, real local Git and Docker integration, full offline four-condition fixture **Target Platform**: Local macOS or Linux host with Docker **Project Type**: Local dual-runtime research CLI **Performance Goals**: Reject invalid blocks before credential or adapter creation; evaluate at most three canonical origins sequentially; add no service, polling tier, or live-run retry **Constraints**: No correctness during model work, no reviewer selection, no origin repair or synthetic reconstruction, no evidence fallback, no token termination for the planned calibration, no validation launch **Scale/Scope**: Five sealed three-agent/six-stage blocks; one four-cell calibration; one shared origin or three isolated origins per attempt; $40 maximum authorization **Puzzle Contribution**: Preserves solver validation while preventing checker-guided correctness search and makes isolated team outcomes inspectable without post-hoc selection **Agent Instructions & Tools**: Preserve the objective, stable team identity, condition-native communication and Git, local tools, activity waiting, model-chosen Git, and `origin/main:solver.py`; describe checker results as runnability and coverage, never correctness **Environmental Constraints**: Private staged evidence and oracle files remain host-only; shared conditions expose peer Git and the enabled team channel, isolated conditions expose only private Git; releases occur at 0, 5, 10, 20, 30, and 40 minutes with a 60-minute wall cutoff and no cumulative token cutoff **Observable Outcomes**: Every canonical origin receives a terminal result; post-freeze records retain aggregate and diagnostic scores, realized product status, collective ceiling, nullable integration gap, checker/Git/communication use, source recognition, resource use, returned reasoning-summary coverage, belief replacement, interference, and provenance **Determinism Claim**: Fixed source bytes, block definition, builder, solver output, and frozen origin commits reproduce builds and scores; provider behavior, model choices, scheduling, source recognition, Git interleavings, collaboration, and human behavior review remain observational

## Constitution Check

_GATE: Passed before research and passed again after design under Constitution 7.0.0._

- **Puzzle behavior before process — PASS**: The prompt changes only the checker disclosure statement and adds no roles, turns, reports, merge procedure, consensus rule, checker limit, or solving recommendation.
- **Environmental constraints, not workflow — PASS**: Blind feedback is determined by execution and token counts independent of correctness; all oracle-backed work occurs after model sessions and origin freeze.
- **Minimal reproducible mechanics — PASS**: The design extends existing files, solver transaction, scorer, artifacts, and CLI. It adds one diagnostic scorer and plural evaluation record because the next calibration directly requires both.
- **Observe outcomes honestly — PASS**: Every canonical origin terminates explicitly; missing integration remains `null` with a reason; low accuracy, source recognition, conflict, and checker use remain outcomes.
- **Condition-defined native collaboration — PASS**: Shared conditions keep one origin and isolated conditions keep three private origins. The evaluator consumes those native topologies without selection, repair, ranking, or merging.
- **Risk-aligned verification — PASS**: Provider-free suites remain advisory. Paid calibration begins only from an exact clean commit with a matching fresh preflight receipt and retains that provenance.

## Project Structure

### Documentation (this feature)

```text
specs/020-blind-team-evaluation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── behavior-review.md
│   ├── checker-feedback.md
│   ├── evaluation-record.md
│   ├── puzzle-build-v4.md
│   └── study-manifest-v5.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
experiments/
├── behavior-rubric.md
├── blocks.json
├── config.yaml
└── schema.json

fixtures/
└── chronicles-of-break-oday.txt

python/palimpsest/
├── evaluation/
│   ├── checker.py
│   ├── diagnostics.py
│   └── score.py
└── puzzle/
    ├── block.py
    ├── build.py
    └── manifest.py

src/
├── artifacts.ts
├── checker.ts
├── cli.ts
├── config.ts
├── evaluate.ts
├── experiment.ts
├── fixture.ts
├── offline.ts
├── prompt.ts
├── run.ts
├── study.ts
├── test-helpers.ts
└── tools.ts

tests/
├── fixtures/config/
├── integration/
└── puzzle/
```

**Structure Decision**: Preserve the flat TypeScript orchestration layer and Python-owned deterministic text mechanics. Blind checking stays in the existing checker bridge but no longer receives a build root or oracle path. Diagnostic scoring belongs beside aggregate scoring in Python. All-origin orchestration belongs in `src/evaluate.ts`; strict durable decoding remains centralized in `src/artifacts.ts`; phase gating remains in `src/study.ts`.

## Design

### Blind Checker Boundary

`check_published_solver` continues to capture literal `refs/heads/main`, materialize only that tree without Git metadata, and run canonical `python3 solver.py` in the one-shot solver sandbox. After output validation, the checker counts normalized word tokens in the released ciphertext and candidate output. It returns commit identity, execution and output-validity status, ciphertext word count, output word count, and `min(outputWords, ciphertextWords) / ciphertextWords`, bounded to `[0, 1]`. No checker call receives a build root, oracle checker directory, plaintext path, key, or score hook.

Submission failures use stable categories for missing ref, failed execution, timeout, output overflow, missing output, empty output, malformed text, and incomplete output. Checker calls and responses continue through the existing trace observer. Prompt text says that validation is not correctness feedback.

### All-Canonical-Origin Evaluation

`puzzle:evaluate` accepts only an attempt path. The evaluator decodes the frozen topology and derives origin targets:

- `CS` and `CR`: the one `shared` repository, evaluated once and marked as the realized team product.
- `IS` and `IR`: `agent-1`, `agent-2`, and `agent-3` repositories, evaluated independently, with no realized integrated product.

Every target uses canonical command and output constants. Each origin result retains repository identity, literal captured ref and commit when available, execution, output status, aggregate score, diagnostics, and error. A missing or unusable ref is a terminal origin outcome, not a reason to omit the origin. Trusted host, sandbox, scorer, seal, and cleanup faults remain infrastructure failures.

The collective ceiling is computed position-wise from scoreable normalized outputs while retaining only derived counts and accuracies in the record. It never writes a reconstruction. Integration gap is `collectiveCeilingAccuracy - realizedProductAccuracy` only when a shared realized product and at least two distinct scoreable origin outputs exist; current native topologies therefore normally record `null` with `shared-single-origin` or `isolated-no-realized-product`.

### Diagnostics

The Python diagnostic scorer receives oracle plaintext, allocation/design records, complete ciphertext, and candidate only in the trusted post-freeze path. It builds a position annotation from the sealed source order and reports exact numerator, denominator, and accuracy for:

- overall, pre-boundary, and post-boundary positions;
- changed positions and their matched stable-control positions, before and after the boundary;
- sentinel and specialist positions, before and after the boundary;
- each stage and each evidence owner;
- each changed type plus an unweighted macro changed-type accuracy;
- expected, predicted, compared, missing, and extra token counts plus bounded coverage.

Empty partitions use `null` accuracy with a zero denominator. Missing candidate tokens count incorrect at their positions. Extra tokens increase the aggregate denominator and are reported separately but do not acquire fabricated stage or evidence labels.

### Evidence and Control Gates

The builder replaces one overloaded allocation tier with:

- `evidenceTier`: the selected specialist ownership/occurrence, solo-coverage, and region/stage-balance threshold;
- `controlTier`: derived independently from complete one-to-one changed/control matching and maximum normalized matching distance.

The bounded window order and allocation-seed order remain unchanged. Discovery begins at `ceil(canonicalParagraphCount * 0.20)` and accepts only 16,000-to-20,000-word windows. Calibration requires `evidenceTier >= balanced`, complete controls, and an explicit control tier. Validation additionally requires `controlTier >= balanced`. No provider-backed command may cross configuration/build preparation before all selected blocks satisfy their phase gate.

`puzzle:build` accepts a local source path directly. The builder recognizes ordinary UTF-8 prose and Gutenberg text/HTML, derives source identity and seed from the bytes, scans the bounded candidate set, applies the declared phase gate, validates the paired manipulation, and atomically publishes the first qualifying sealed build. Any parsing or eligibility failure exits nonzero without output or paid work; there is no discovery artifact or manual pin-promotion step.

### Strict Records and Behavior Review

Manifest v5 separates `checking` and `scoring`. Puzzle-build v4 carries both validity tiers. Attempt-summary v6 binds the resolved policies and canonical frozen-origin set. Design-receipt v3 binds all rebuilt blocks, rubric, checker, scorer, diagnostic, and evaluation-policy identities. Evaluation-record v2 contains origin results and derived team-level results.

The behavior rubric and generated review record use trace-grounded nullable observations. They record communication and integration, negative interference and recovery, prior-rule/evidence/replacement/effect sequences, source-recognition evidence and first explicit time, checker use without correctness interpretation, usage, returned reasoning-summary coverage, and final origin provenance. An empty returned summary is captured-empty evidence. The record does not infer hidden reasoning and does not make model-quality fields validity gates.

### Verification and Paid Calibration

Tests are written before each behavior change and include direct filesystem guards proving the blind checker does not open oracle files. The offline fixture produces one shared and three isolated results, exact synthetic diagnostics, collective-ceiling/null-gap cases, and pre-credential fallback rejection. Source workflow tests cover deterministic acceptance and rejection without partial publication. `pnpm ci:local`, `pnpm verify`, and `pnpm preflight` run after implementation; preflight runs only on the exact clean committed source and precise runnable sandbox.

The paid phase reuses the existing ignored OpenAI credential only after the provider-free gates pass. A fresh ignored study root receives one immutable design receipt and sequential `CS`, `CR`, `IR`, and `IS` attempts on `calibration-odd-women`. The manifest selects three GPT-5.6-sol medium-reasoning bindings, the declared one-hour schedule, null token ceilings, and $10 per attempt/$40 total authorization. Each attempt auto-evaluates and generates diagnostics and behavior review. The workflow stops after calibration regardless of observed model quality.

## Complexity Tracking

No constitution exception is required. Plural evaluation and diagnostics extend the existing final-evaluation artifact rather than adding a service, database, ranking layer, replay engine, or synthetic integration path.
