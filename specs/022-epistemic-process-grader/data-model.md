# Data Model: Epistemic Process Grader

## Design Rules

- Existing run evidence is immutable. Grading adds analyses only.
- Every derived fact records provenance and observability.
- Qualitative review is blind to identity and outcome until frozen.
- Shared and isolated conditions retain their existing canonical-origin semantics.
- Large detail files are content-digested and addressed through safe paths from `run.json`.
- Unknown fields fail strict decoding; legacy records containing only existing analysis kinds remain valid.

## EvidenceReference

A stable pointer used by measures and reviewer claims.

| Field | Type | Rules |
| --- | --- | --- |
| `source` | `trace`, `run-record`, or `git` | Required |
| `traceSequence` | positive integer | Required only for trace evidence |
| `recordPointer` | JSON Pointer | Required only for run-record evidence; must target an allowed non-blinded field |
| `originId` | canonical origin ID | Required only for Git evidence |
| `commit` | 40-character object ID | Required for Git evidence |
| `path` | safe relative path | Optional Git file target |
| `excerptDigest` | SHA-256 | Digest of the exact normalized cited material |
| `role` | `support`, `counterevidence`, or `context` | Required |

Validation resolves the pointer against the frozen run, rejects secret or outcome references in pre-outcome review, and recomputes the excerpt digest.

## EvidenceItem

A reviewer-visible normalized observation.

| Field | Type | Rules |
| --- | --- | --- |
| `evidenceId` | string | Deterministic from source reference and normalized content |
| `atMs` | non-negative number | Monotonic within the run |
| `actorId` | anonymized agent ID or `runner` | Never contains model/provider identity |
| `kind` | controlled observation kind | Maps from retained trace/Git facts |
| `content` | JSON value or bounded text | Contains only reviewer-allowed data |
| `reference` | `EvidenceReference` | Resolves to original immutable evidence |
| `availability` | `full`, `excerpted`, or `metadata-only` | Explicit |
| `omissionReason` | string | Required unless availability is `full` |

## EvidenceBundle

The complete local index and the outcome-blind surface used for process review.

| Field | Type | Rules |
| --- | --- | --- |
| `schemaVersion` | `1` | Required |
| `bundleId` | string | Derived from grading configuration and content digest |
| `runFingerprint` | opaque digest | Links the bundle without revealing run/model identity to judges |
| `communicationMode` | `shared` or `isolated` | Required to determine social applicability |
| `actors` | ordered anonymized IDs | Must match eligible agents |
| `items` | ordered `EvidenceItem[]` | Strictly chronological, then source-stable |
| `windows` | ordered evidence-ID ranges | Covers every item exactly once for first-pass review |
| `omissions` | omission manifests | Records excluded fields, payload sizes, digests, and reasons |
| `sourceDigest` | SHA-256 | Covers original run/trace/topology identities |
| `contentDigest` | SHA-256 | Covers the canonical bundle |

Prohibited reviewer content includes model profile, requested or actual model/provider, experiment labels that reveal identity, oracle material, final evaluation, reconstruction score, success label, and post-run outcome analysis.

## QuantitativeMeasure

A deterministic or frozen-coded observation, never an unqualified quality claim.

| Field | Type | Rules |
| --- | --- | --- |
| `measureId` | versioned controlled ID | Stable semantics within one grader version |
| `ledger` | `outcome`, `epistemic`, `social`, or `instrumental` | Required |
| `basis` | `mechanical` or `review-coded` | Required |
| `state` | `observed`, `unavailable`, or `not-applicable` | Required |
| `value` | finite number or categorical value | Present only when observed |
| `unit` | controlled unit | Present only when observed |
| `numerator` | finite number | Optional |
| `denominator` | finite positive number | Required for rates |
| `eligibility` | explanation and rule ID | Required |
| `evidence` | `EvidenceReference[]` | Required for observed values |

Initial mechanical measures include final runnable/coverage/accuracy facts, elapsed time, stage-to-first-action latency, tool mix, checker use, message/read activity, Git publication activity, token use, termination, and contribution balance. Counts remain descriptive. Initial review-coded measures include supported-revision opportunity rate, contribution-to-uptake rate, integration latency, and disagreement rate.

## EpistemicEpisode

An evidence-bounded candidate transition, not a hidden-state assertion.

| Field | Type | Rules |
| --- | --- | --- |
| `episodeId` | review-local stable string | Unique within one review |
| `summary` | bounded text | Uses observable language |
| `status` | `supported-revision`, `asserted-only`, `missed-revision`, `unchanged`, or `ambiguous` | Required |
| `evidence` | references | Zero or more; missing stages explicit |
| `commitment` | references | Zero or more |
| `test` | references | Zero or more |
| `revision` | references | Zero or more |
| `transmission` | references | Zero or more; not applicable when isolated |
| `uptake` | references | Zero or more; not applicable when isolated |
| `integration` | references | Zero or more |
| `counterevidence` | references | Required when status is disputed or missed |
| `confidence` | `low`, `medium`, or `high` | Required |

## DimensionReview

One ordinal judgment under a versioned rubric.

| Field | Type | Rules |
| --- | --- | --- |
| `dimensionId` | rubric dimension ID | Must exist in the declared rubric |
| `ledger` | `epistemic`, `social`, or `instrumental` | Must match rubric |
| `state` | `rated`, `unobservable`, or `not-applicable` | Required |
| `rating` | integer 0-4 | Present only when rated; anchored per dimension |
| `rationale` | bounded text | Required; describes behavior, not identity |
| `evidence` | supporting references | Required when rated |
| `counterevidence` | references | Required field, may be empty |
| `confidence` | `low`, `medium`, or `high` | Required |

Rating anchors are dimension-specific, but share this direction: 0 is absent or actively harmful when observable; 1 is weak; 2 is mixed or partial; 3 is strong; 4 is unusually strong and consistently evidenced. Unobservable and not applicable are never encoded as zero.

## JudgeReview

One independent, immutable qualitative interpretation.

| Field | Type | Rules |
| --- | --- | --- |
| `reviewId` | string | Unique and immutable |
| `status` | `completed`, `invalid`, or `provider-error` | Required |
| `rubricVersion` | string | Exact version |
| `bundleDigest` | SHA-256 | Must match reviewed bundle |
| `judge` | provider family, requested model, actual identity | Attached only after judgment returns |
| `dimensions` | complete dimension set | Required when completed |
| `episodes` | `EpistemicEpisode[]` | Required when completed |
| `overallCautions` | bounded strings | No total score |
| `rawResponsePath` | safe relative path | Immutable raw response or failure detail |
| `rawResponseDigest` | SHA-256 | Required when a response exists |

Two reviews for the same analysis must use distinct provider families. A failed review remains visible and prevents findings-bearing completion; the operator may start a new explicit review analysis but the system does not retry automatically.

## RunScorecard

The run-level non-composite presentation assembled after process reviews freeze.

| Field | Type | Rules |
| --- | --- | --- |
| `runId` | string | Reintroduced only after review freeze |
| `canonicalOrigins` | ordered origin facts | Every origin retained; no best selection |
| `outcome` | existing evaluations and mechanical measures | Never changes process ratings |
| `epistemic` | two reviews plus coded measures | Separate reviewer values |
| `social` | two reviews plus coded measures | Not applicable where peer collaboration is absent |
| `instrumental` | two reviews plus coded measures | Separate reviewer values |
| `disagreements` | per-dimension and episode differences | Always explicit |
| `eligibility` | completed, censored, or excluded with reason | Required |
| `limitations` | missingness and claim bounds | Required |

## PerformanceAnalysis

The `RunAnalysis` variant appended by provider-free grading.

| Field | Type | Rules |
| --- | --- | --- |
| `analysisId` | string | Unique in the run |
| `kind` | `performance` | Discriminator |
| `analyzedAt` | canonical UTC timestamp | Required |
| `graderVersion` | string | Exact measure definitions |
| `configurationDigest` | SHA-256 | Exact provider-free grading configuration |
| `sourceDigest` | SHA-256 | Validated run/trace/topology identity |
| `detailsPath` | safe relative path | Under `grading/<analysisId>/` |
| `detailsDigest` | SHA-256 | Covers evidence manifest and metrics |
| `origins` | ordered origin eligibility summaries | Every canonical origin |

## ProcessReviewAnalysis

The `RunAnalysis` variant appended by qualitative review.

| Field | Type | Rules |
| --- | --- | --- |
| `analysisId` | string | Unique in the run |
| `kind` | `process-review` | Discriminator |
| `reviewedAt` | canonical UTC timestamp | Required |
| `status` | `completed` or `incomplete` | Completed requires two valid reviews |
| `performanceAnalysisId` | string | References the exact provider-free basis |
| `rubricVersion` | string | Exact anchors and prompts |
| `configurationDigest` | SHA-256 | Includes reviewer profiles and token limits |
| `bundleDigest` | SHA-256 | Identical for both judges |
| `detailsPath` | safe relative path | Under `grading/<analysisId>/` |
| `detailsDigest` | SHA-256 | Covers reviews and scorecard |
| `reviews` | ordered status/provenance summaries | Exactly two configured reviewer attempts |

## BehaviorReport

A provider-free, cross-run output that does not mutate source run records.

| Field | Type | Rules |
| --- | --- | --- |
| `reportId` | string | Derived from request and included analyses |
| `createdAt` | timestamp | Required |
| `claimType` | `descriptive` or `matched-contrast` | Causal language allowed only for declared matched contrasts |
| `experimentalUnit` | declaration | Must state team/origin and clustering rule |
| `matchingFields` | run input pointers | Required for matched contrast |
| `treatmentField` | one declared input | Required for matched contrast |
| `included` | run/analysis references | Required |
| `excluded` | references and reasons | Required |
| `dimensions` | distributions, missingness, uncertainty | Never collapsed into a total |
| `reviewerAgreement` | per-dimension summaries | Required for qualitative reports |
| `outcomeLinks` | process-outcome associations | Clearly observational unless design supports more |
| `limitations` | strings | Required |

## Relationships

```text
RunRecord
  ├── PerformanceAnalysis ──> EvidenceBundle + QuantitativeMeasure[]
  └── ProcessReviewAnalysis ──> JudgeReview[2] ──> DimensionReview[]
                                      └──────────> EpistemicEpisode[]
                         └────────────> RunScorecard

BehaviorReport ──> many RunScorecards + declared matching design
```

## State Transitions

### Provider-Free Grade

`loaded -> validated -> evidence-indexed -> measured -> details-published -> analysis-appended`

Any failure stops before the next state. A run with status other than completed is reported ineligible and is not assigned a performance analysis. If final record append fails after a new detail directory is published, only that explicitly named unreferenced directory is removed.

### Qualitative Review

`loaded -> exact-input-validated -> leakage-checked -> spend-authorized -> judge-responses-retained -> citations-validated -> process-frozen -> outcome-linked -> analysis-appended`

Missing authorization stops before provider construction. One invalid or failed judge produces an explicit incomplete review analysis and no findings-bearing scorecard. There is no automatic retry or consensus stage.

### Batch Report

`requested -> analyses-validated -> eligibility-resolved -> matching-checked -> aggregated -> published`

Unmatched input never silently becomes a matched contrast. Source runs remain unchanged.
