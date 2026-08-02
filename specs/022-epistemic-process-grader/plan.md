# Implementation Plan: Epistemic Process Grader

**Branch**: `022-epistemic-process-grader` | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/022-epistemic-process-grader/spec.md`

## Summary

Add a local, evidence-first grading pipeline for completed Palimpsest runs. A provider-free pass validates the frozen run, constructs a blinded evidence index, and computes deterministic outcome and activity measures. A separately authorized review pass sends only outcome-blind evidence windows to two distinct-provider judges, validates every citation, preserves each judgment and disagreement, then links the frozen process review to the existing outcome. A reporting pass compares dimension distributions only across explicitly matched runs. The result is a non-composite scorecard that distinguishes what happened, what reviewers infer, and what the experiment can support.

## Technical Context

**Language/Version**: TypeScript 7.0.2 on Node.js 26.5.0; Python 3.12.4  
**Primary Dependencies**: Existing AI SDK provider adapters, Zod, AJV, YAML, Node file/process APIs, Git CLI, and Python standard library  
**Storage**: Existing local `run.json`, append-only `trace.jsonl`, frozen Git repositories, strict YAML grading configuration, and immutable JSON grading details under each run root  
**Testing**: Vitest unit/contract/acceptance projects; pytest unit/contract/material markers; checked-in synthetic and redacted-real grading fixtures  
**Target Platform**: Local macOS and Linux command line; provider-free grading requires no Docker or provider credential  
**Project Type**: Local research CLI with TypeScript orchestration and Python scoring  
**Performance Goals**: Provider-free evidence extraction and metrics remain linear in retained events and Git objects; a representative multi-thousand-event run completes without loading unrelated repository blobs; batch reporting streams scorecards rather than traces  
**Constraints**: No database or hosted service; no mutation of frozen evidence or original scores; no hidden-state claims; no outcome or model-identity leakage into process review; no automatic reviewer retry; explicit spend authorization for qualitative review; legacy missing observations stay missing  
**Scale/Scope**: Individual runs with thousands of trace events and tens of megabytes of frozen work; findings-bearing batches of tens to low hundreds of completed runs; one team unit for shared runs and all canonical origins for isolated runs  
**Puzzle Contribution**: None. The feature evaluates existing observable behavior and leaves puzzle mechanics and solver feedback unchanged.  
**Agent Instructions & Tools**: Existing objective, team identity, evidence, communication condition, ordinary Git, shell/file tools, optional checker, and `origin/main:solver.py` contract remain unchanged; the grader adds no role, turn, checkpoint, report, branch, or coordination requirement.  
**Environmental Constraints**: Existing evidence visibility, stage schedule, peer visibility, wall/token limits, network boundary, sandbox, and secrets remain authoritative. The only added live observation is the resolved ref target associated with future `git.changed` events, captured without model feedback or control flow.  
**Observable Outcomes**: Existing trace, usage, communication, tools, Git activity, frozen trees, session endings, and evaluations; deterministic activity measures; evidence-linked epistemic episodes; independent dimension reviews; citation validity; disagreement; and matched-run reports.  
**Determinism Claim**: Run validation, evidence selection/redaction, metric computation, citation validation, outcome linkage, and aggregation are deterministic for fixed artifacts and configuration. Judge interpretations and live model behavior remain stochastic and are retained independently rather than normalized into deterministic truth.

## Constitution Check

**Pre-Research Result**: PASS

- **Puzzle behavior before process**: The grader is post-run and does not modify the prompt, puzzle, checker, solver interface, or agent-visible feedback.
- **Environmental constraints, not workflow**: It observes existing choices and adds no required reasoning log, checkpoint, role, turn, intermediate file, or Git sequence.
- **Minimal reproducible mechanics**: It extends the existing analysis seam and local file boundary with two current experimental needs: evidence-cited process assessment and matched-run reporting.
- **Observe outcomes honestly**: Outcome facts, process interpretation, missingness, reviewer disagreement, interruption, and infrastructure failure remain separate.
- **Condition-defined native collaboration**: Shared runs remain one team result; isolated runs expose no invented peer behavior; every canonical origin remains represented and no best result is selected.
- **Research and secret boundary**: Review bundles exclude provider/model identity, oracle data, hidden keys, final scores, and success labels. Trusted package material never enters the review surface.
- **Risk-aligned verification**: Provider-free grading is advisory and offline. Paid review validates exact inputs and requires explicit spend authorization before creating a provider adapter.

**Post-Design Result**: PASS. The design adds one neutral Git ref-target observation because historical `git.changed` events name changed refs but not their exact commit at that moment. It does not require a model action, expose feedback, or gate behavior. Historical runs report the unavailable trajectory rather than receiving inferred values.

## Project Structure

### Documentation (this feature)

```text
specs/022-epistemic-process-grader/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── data.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── cli.ts                         # grade, review, and report command routing
├── trace.ts                       # strict observation loading; future ref-target field
├── grading/
│   ├── contracts.ts               # evidence, metric, review, and report decoders
│   ├── evidence.ts                # blinded evidence index and chronological windows
│   ├── grade.ts                   # provider-free run analysis orchestration
│   ├── review.ts                  # authorized independent judge orchestration
│   ├── report.ts                  # matched-run aggregation
│   └── rubric.ts                  # versioned dimensions and rating anchors
├── model/                         # existing provider-neutral judge adapters
└── run/
    └── record.ts                  # performance and process-review analysis variants

python/
├── palimpsest/evaluation/
│   └── process.py                 # deterministic process/activity measures
└── tests/evaluation/
    └── test_process.py

tests/
├── fixtures/grading/              # synthetic contrasts and redacted-real evidence cases
├── contract/                      # CLI and strict data-boundary coverage
└── puzzle/                        # end-to-end provider-free grading/reporting coverage
```

**Structure Decision**: Keep TypeScript responsible for strict run/trace loading, Git observation, redaction, provider calls, and atomic publication. Keep Python responsible for deterministic scoring and measure definitions. Reuse the existing subprocess, model adapter, run-analysis, and local-file patterns; add no service, database, queue, or new runtime.

## Design Sequence

1. Extend strict run-analysis decoding with backward-compatible `performance` and `process-review` variants and immutable detail references.
2. Build the provider-free evidence compiler: validate the run boundary, index every eligible observation, redact identity/outcome fields, record omissions, and verify stable citations.
3. Add Python quantitative measures for outcome, activity, resource, publication, and collaboration opportunity, with explicit denominators and missingness.
4. Implement `puzzle:grade` to atomically publish evidence/metrics details and append one `performance` analysis without changing prior evidence or scores.
5. Add the versioned rubric and two-judge review pipeline, including chronological evidence windows, spend preflight, citation checks, immutable raw reviews, and outcome linkage only after process judgments freeze.
6. Implement `puzzle:review` and append `process-review` analyses whose incomplete or disagreeing reviewer states remain explicit.
7. Implement `puzzle:report` for per-dimension distributions, uncertainty, eligibility, disagreement, and declared matched contrasts; reject unsupported causal labels and composite rankings.
8. Add synthetic contrast fixtures, leakage/citation failures, historical missingness cases, redacted-real artifact cases, and provider-free end-to-end verification.

## Verification Strategy

- Contract tests reject unknown fields, unsafe paths, broken digests, invalid evidence pointers, outcome leakage, model identity leakage, duplicate analyses, and malformed judge output.
- Golden tests prove identical provider-free measures for identical artifacts and prove that unavailable observations are missing rather than zero.
- Contrast fixtures cover lucky success, strong-process failure, ignored contrary evidence, supported revision, asserted-only revision, useful uptake, empty communication, duplication, and isolated not-applicable collaboration.
- Judge tests use deterministic fake adapters to prove independent reviews remain separate, invalid citations fail, disagreement survives, and outcome changes cannot affect frozen process input.
- Run-record tests prove analysis append is atomic and leaves trace, evaluations, topology, and previous analyses byte-stable.
- Aggregate tests enforce matching declarations, cluster related origins by run, retain distributions/uncertainty, and refuse a composite or single-run causal claim.
- Prompt and tool-surface regression tests prove the feature adds no agent-facing process requirement.

## Complexity Tracking

No constitution violations require an exception.
