# Epistemic Process Grading

Palimpsest grades observable work after a run without changing the puzzle or prescribing how agents should solve it. The grader separates deterministic outcome facts from evidence-linked epistemic, social, and instrumental interpretation. It never emits a composite score.

## Provider-Free Performance Analysis

`puzzle:grade --run-root <run>` validates a completed record, its read-only trace, fixture relationship, contained topology, and frozen tree. It then builds a chronological identity-blind and outcome-blind evidence index and computes deterministic measures. Each measure declares its eligibility, state, denominator where applicable, provenance, and whether it is mechanical or derived from frozen reviews.

Large payloads are represented by bounded excerpts and explicit omission metadata. Unknown or unavailable historical observations remain metadata-only or unavailable rather than becoming zero. The performance details are written under `grading/<analysis-id>/` before one strict `performance` reference is appended to `run.json`. Frozen trace events, evaluations, topology, status, and earlier analyses remain unchanged.

## Independent Process Review

`puzzle:review` requires the exact performance analysis, one strict grading configuration, two reviewer profiles from different official provider families, a cumulative token limit and per-call output limit for each reviewer, and literal `--allow-spend true`. Validation and leakage checks complete before provider construction. Provider-reported input and output tokens accumulate independently for each reviewer. A response that crosses the cumulative limit is still retained, but the review becomes incomplete and makes no further call. The authorization permits provider access; it is not a monetary billing cap.

Each reviewer receives the same deterministic evidence windows and versioned rubric. Model and provider identity, experiment labels that reveal identity, oracle material, final evaluations, reconstruction scores, success labels, and prior reviews are absent. Raw window and integration responses are retained separately from validated reviews. Every rating and episode transition must resolve to allowed evidence. Invalid citations, malformed output, provider failure, confidence, counterevidence, and disagreement remain explicit; there is no automatic retry, consensus, or averaging.

One scorecard entry is published for each canonical origin. A shared run has one team entry; an isolated run retains every origin and reports social dimensions as not applicable. Process judgments freeze before outcome facts are joined.

## Rubric Interpretation

The rubric has separate epistemic, social, and instrumental dimensions with behaviorally anchored ratings from zero through four. `unobservable` and `not-applicable` are states, not ratings. Epistemic episodes describe observable commitments, tests, revisions, transmission, uptake, and integration while allowing missing stages and competing interpretations. They do not claim access to private thoughts.

Mechanical activity counts describe what happened. Message, token, tool, checker, or commit volume is not treated as process quality. Review-coded rates retain the reviewer that supplied each judgment as their basis.

## Reports And Claims

`puzzle:report` reads completed scorecards without changing source runs. Descriptive reports may summarize any explicitly included compatible analyses. Matched contrasts additionally require a declared treatment, matched non-treatment input pointers, experimental unit, and run clustering. Mismatches, missing analyses, incomplete reviews, and incompatible versions are exclusions with reasons, not silent filtering.

Reports preserve distributions, missingness, uncertainty, reviewer agreement, origin clustering, and process-outcome associations. A single run can illustrate a mechanism but cannot establish a stable model trait. Unmatched collections cannot support causal language, and software tests do not establish construct validity.

## Calibration And Censored Attempts

Before findings-bearing use, freeze the rubric and calibration corpus, audit citations on a stratified identity-blind and outcome-blind sample, and inspect disagreement by dimension. Anchor changes require a new rubric version; existing reviews are immutable.

A trace without a completed `run.json` is an interrupted attempt. Version 1 rejects it from completed grading and reporting. A future censored-summary surface may describe retained observations, but it must not assign a completed-run grade or enter completed denominators.
