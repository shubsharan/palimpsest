# Research: Epistemic Process Grader

## Evidence From Current Run Artifacts

Completed runs already provide a strong observational substrate: chronological stage releases, full team messages, model-visible response text, tool names and arguments, tool results, Git-change notifications, usage, termination, frozen origins and workspaces, and canonical-origin evaluations. Current successful traces range from hundreds to several thousand events. They support reconstructing hypotheses, tests, communication, tool use, and final publication without asking agents to produce a separate reasoning diary.

The important limits are equally informative. `git.changed` currently identifies the repository and changed refs but not the exact target commit at that instant. Final frozen Git retains commit history, but historical event-to-commit attribution may be ambiguous. Model response records expose actual provider/model identity, and evaluation events expose outcomes, so raw traces cannot be sent directly to a blinded reviewer. Many high-volume events describe activity but do not by themselves establish quality, uptake, or revision.

## Decisions

### 1. Evaluate Functional Epistemic Behavior

**Decision**: Define the object of evaluation as observable commitments, evidence use, tests, revisions, communication, integration, and published consequences. Use "belief revision" as shorthand for an evidenced functional transition, never as a claim about private mental state.

**Rationale**: The artifacts reveal behavior and statements, not consciousness or hidden chain of thought. This boundary permits disciplined comparison without pretending that human-sounding narration provides privileged access.

**Alternatives considered**: Treating self-reported reflection as ground truth was rejected because claims can be strategic or post hoc. Ignoring semantic process entirely was rejected because it collapses the research question back into solve rate.

### 2. Use Epistemic Episodes as the Unit of Qualitative Evidence

**Decision**: Reconstruct bounded episodes around evidence, commitment, test, revision, transmission, uptake, and integration. Stages may be absent; the review must say which are observed, contradicted, ambiguous, or missing.

**Rationale**: Episodes preserve temporal and causal structure better than global impressions. They make partial credit concrete: a model may frame a good hypothesis, run a poor test, respond well to contrary evidence, and still fail to integrate the result.

**Alternatives considered**: Whole-trace holistic scores were rejected as difficult to audit. Mandatory agent-authored belief ledgers were rejected because they alter the workflow under study.

### 3. Keep Three Process Ledgers and Outcome Separate

**Decision**: Publish four sections, never one composite:

- Epistemic: framing, hypothesis quality, discriminating evidence use, calibration, and revision.
- Social: contribution, transmission, uptake, integration, verification, duplication, and repair.
- Instrumental: tool use, validation, publication, resource allocation, and error recovery.
- Outcome: existing runnable status, coverage, accuracy, and other deterministic result facts.

**Rationale**: Distinct ledgers prevent a correct answer from laundering weak process and prevent an elegant process from being mislabeled a solve. They also reveal compensating strengths that a total score would erase.

**Alternatives considered**: A weighted total was rejected because the weights would embed an unvalidated theory of good machine cognition. A pass/fail rubric was rejected because it destroys partial credit.

### 4. Separate Mechanical Measures From Semantic Judgments

**Decision**: Compute provider-free activity and outcome measures deterministically. Treat episode counts, revision quality, contribution value, and uptake as reviewer-coded measures whose provenance includes the frozen reviews.

**Rationale**: Message count, token count, commit count, or tool count are observations, not quality. The system should expose these quantities without rewarding verbosity or activity theater.

**Alternatives considered**: Heuristic keyword classification was rejected as brittle and easy to game. Making all grading qualitative was rejected because deterministic measures are reproducible, cheap, and useful as descriptive covariates.

### 5. Blind Process Review Prospectively

**Decision**: Create a deterministic reviewer bundle that removes requested and actual model/provider identity, experiment labels that reveal identity, oracle material, final evaluation events, reconstruction scores, and success labels. Freeze both process reviews before joining them to outcome facts.

**Rationale**: Outcome knowledge creates hindsight bias, and model identity invites reputation priors. Prospective separation allows later analysis of whether highly rated process predicts success.

**Alternatives considered**: Asking reviewers to ignore visible outcomes was rejected as weaker than removing them. Permanently separating process and outcome was rejected because predictive validity is a central research question.

### 6. Preserve Two Independent Reviewer Views

**Decision**: Findings-bearing review uses two configured judges from distinct provider families. Each works from the same blinded evidence bundle and rubric. Raw outputs, validated reviews, confidence, counterevidence, and disagreement remain separate; no automatic retry or silent averaging occurs.

**Rationale**: A second differently sourced judgment reveals rubric ambiguity and judge-specific priors. Preserved disagreement is data about the measurement instrument, not noise to hide.

**Alternatives considered**: One judge was rejected as too fragile for qualitative claims. Majority voting with three judges was rejected as unnecessary cost before two-judge calibration shows a concrete need. A judge panel that debates toward consensus was rejected because it destroys independent evidence.

### 7. Require Evidence-Resolvable Citations

**Decision**: Every substantive review claim cites stable trace sequences, run-record fields, or frozen Git objects. The system validates existence, allowed visibility, and excerpt digest. Unsupported claims are rejected or explicitly marked unobservable.

**Rationale**: Citations turn fluent evaluation into an auditable scientific artifact and allow human calibration without rereading an entire run.

**Alternatives considered**: Free-form rationales were rejected because they cannot reliably distinguish inspection from invention. Line-number-only citations into rendered logs were rejected because rendering can change.

### 8. Use Chronological Evidence Windows Without Silent Loss

**Decision**: Retain a complete evidence index locally and create deterministic chronological review windows sized to the configured judge context. Every omitted or summarized payload is represented by its source reference, digest, size, and reason. Judges first annotate candidate episodes per window, then integrate only cited candidates across the full run.

**Rationale**: Current traces can contain thousands of events. Windowing preserves order and coverage while avoiding a one-shot context overflow. The omission manifest makes information loss visible.

**Alternatives considered**: Sending only team messages was rejected because tool and Git consequences matter. One unrestricted prompt was rejected because it fails unpredictably on long runs. Model-generated summaries without source pointers were rejected because they compound interpretation.

### 9. Add Only a Neutral Future Git Observation

**Decision**: Future `git.changed` trace events include the resolved object ID for every changed published ref. Historical runs use frozen history where unambiguous and mark event-level trajectories unavailable otherwise.

**Rationale**: Contribution, uptake, and integration claims need to connect communication and edits to a concrete shared artifact state. Capturing a ref target observes an existing event and does not prescribe a commit cadence or offer feedback.

**Alternatives considered**: Periodic forced snapshots were rejected because they impose infrastructure cadence and storage cost. Timestamp inference for historical runs was rejected as false precision.

### 10. Extend the Existing Append-Only Analysis Boundary

**Decision**: Add `performance` and `process-review` variants to `RunAnalysis`. Store large immutable details in `grading/<analysis-id>/` and append strict digested references to `run.json`. Write the details atomically before appending the record; remove a newly written unreferenced directory if publication fails.

**Rationale**: This reuses the existing analysis history without bloating the record or changing frozen evidence. A run record remains the index of evidentiary analyses.

**Alternatives considered**: A database was rejected as unnecessary. Mutating existing evaluations was rejected because it would erase the outcome/process distinction. A parallel mutable current-score file was rejected because it weakens provenance.

### 11. Keep Runtime Ownership Consistent

**Decision**: TypeScript validates artifacts, builds/redacts evidence, observes Git, invokes judges, and publishes analyses. Python calculates deterministic measures and batch statistics from strict requests. Reuse the existing provider adapters and Python subprocess boundary.

**Rationale**: This matches Palimpsest's current ownership rules and avoids duplicate parsing or a new service boundary.

**Alternatives considered**: An all-TypeScript grader was rejected because scoring belongs to the trusted Python research plane. A Python provider client was rejected because provider-neutral session machinery already exists in TypeScript.

### 12. Make Comparisons Explicitly Design-Aware

**Decision**: Reports require declared grouping, matching inputs, treatment field, and experimental unit. Shared runs count as team units; isolated canonical origins remain visible but are clustered under their run when estimating uncertainty. Single runs and unmatched sets are labeled descriptive.

**Rationale**: A polished dashboard can otherwise turn pseudo-replication and configuration drift into misleading model rankings.

**Alternatives considered**: Automatically inferring matched sets from convenient labels was rejected because labels are not the experimental contract. Global model leaderboards were rejected because this puzzle is not a construct-validated benchmark.

## Rubric Calibration Protocol

Before findings-bearing use, freeze the rubric version and calibration corpus. The corpus includes synthetic contrast pairs plus a stratified, redacted sample of successful, partial, unsuccessful, and behaviorally unusual real runs. Human reviewers annotate episodes and dimensions while blinded to model and outcome. Evaluate citation resolvability, leakage, observability decisions, ordinal agreement, and disagreement concentration by dimension. Revise the rubric rather than hiding dimensions with systematic disagreement, then assign a new rubric version. Green software tests validate mechanics; they do not establish construct validity.
