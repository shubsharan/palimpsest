# Epistemic Process Grading

Palimpsest grades observable work after a run without changing the puzzle or prescribing how agents should solve it. The grader separates deterministic outcome facts from evidence-linked epistemic, social, and instrumental interpretation. It never emits a composite score.

## Provider-Free Performance Analysis

`puzzle:grade --run-root <run>` validates a completed record, its read-only trace, fixture relationship, contained topology, and frozen tree. It then builds a chronological identity-blind and outcome-blind evidence index and computes deterministic measures. Each measure declares its eligibility, state, denominator where applicable, provenance, and whether it is mechanical or derived from frozen reviews.

Large payloads are represented by bounded excerpts and explicit omission metadata. Unknown or unavailable historical observations remain metadata-only or unavailable rather than becoming zero. The performance details are written under `grading/<analysis-id>/` before one strict `performance` reference is appended to `run.json`. Frozen trace events, evaluations, topology, status, and earlier analyses remain unchanged.

## Independent Process Review

`puzzle:review` requires the exact performance analysis, one strict grading configuration, two reviewer profiles from different official provider families, a cumulative token limit and per-call output limit for each reviewer, and literal `--allow-spend true`. Validation and leakage checks complete before provider construction. Provider-reported input and output tokens accumulate independently for each reviewer. A response that crosses the cumulative limit is still retained, but the review becomes incomplete and makes no further call. The authorization permits provider access; it is not a monetary billing cap.

Each reviewer receives the same three deterministic ledger packets and versioned rubric. Protocol v6 explicitly declares the shared team or isolated origin as the evaluation unit and supplies a common opportunity registry. Model and provider identity, oracle material, final evaluations, scores, success labels, and prior reviews remain absent. Reviewers return structured claims tied to opportunity and citation IDs; packet-local claim IDs and structurally inconsistent actor scopes are normalized deterministically with labeled cautions while raw responses remain immutable. Readable rating rationales are rendered deterministically. Invalid citations, malformed output, provider failure, counterevidence, and disagreement remain explicit; there is no automatic retry, consensus, or averaging.

One scorecard-v2 entry is published for each canonical origin. Its primary surface is two independent evidence dossiers containing structured claims, epistemic episodes, influence chains, and execution chains. Advisory ratings follow the dossier. Layered failure accounts prohibit automated model causation, and full fixture/treatment/model/record/confound provenance is joined only after process judgments freeze.

## Rubric Interpretation

The rubric has separate epistemic, social, and instrumental dimensions with behaviorally anchored ratings from zero through four. `unobservable` and `not-applicable` are states, not ratings. Epistemic episodes describe observable commitments, tests, revisions, transmission, uptake, and integration while allowing missing stages and competing interpretations. They do not claim access to private thoughts.

Mechanical activity counts describe what happened. Message, token, tool, checker, or commit volume is not treated as process quality. Review-coded rates retain the reviewer that supplied each judgment as their basis.

## Reports And Claims

`puzzle:report` reads completed scorecards without changing source runs. Descriptive reports may summarize any explicitly included compatible analyses. Matched contrasts additionally require a declared treatment, matched non-treatment input pointers, experimental unit, and run clustering. Mismatches, missing analyses, incomplete reviews, and incompatible versions are exclusions with reasons, not silent filtering.

Reports lead with mechanism prevalence and opportunity-conditioned rates, then preserve provenance, layered failure accounts, typed disagreement, advisory rating distributions, missingness, uncertainty, clustering, and process-outcome associations. A single run can illustrate a mechanism but cannot establish a stable model trait. Unmatched collections cannot support causal language.

## Automated Calibration And Censored Attempts

`puzzle:calibrate` reads completed scorecard-v2 artifacts and reports citation integrity, explicit unit scope, stage consistency, observability, and reviewer stability without provider access. It does not adjudicate reviews or establish construct validity. Protocol or anchor changes require a new version; existing reviews remain immutable.

A trace without a completed `run.json` is an interrupted attempt. Version 1 rejects it from completed grading and reporting. A future censored-summary surface may describe retained observations, but it must not assign a completed-run grade or enter completed denominators.
