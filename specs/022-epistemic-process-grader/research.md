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

**Decision**: Findings-bearing review uses two configured reviewers from distinct provider families. Each receives the same deterministically compiled ledger packets and rubric. Raw packet outputs, assembled reviews, confidence, counterevidence, and disagreement remain separate; no model adjudication, automatic retry, or silent averaging occurs.

**Rationale**: A second differently sourced judgment reveals rubric ambiguity and judge-specific priors. Preserved disagreement is data about the measurement instrument, not noise to hide.

**Alternatives considered**: One judge was rejected as too fragile for qualitative claims. Majority voting with three judges was rejected as unnecessary cost before two-judge calibration shows a concrete need. A judge panel that debates toward consensus was rejected because it destroys independent evidence.

### 7. Require Evidence-Resolvable Citations

**Decision**: Every substantive review claim cites stable trace sequences, run-record fields, or frozen Git objects. Protocol v4 asks the provider for arrays of compact packet-local tokens matching `^c[0-9]{3}$`. The portable provider schema validates only that compact syntax; after parsing, the system deterministically validates every token against the exact packet citation index, then resolves it to the full source reference and excerpt digest. Unsupported claims are rejected or explicitly marked unobservable.

**Rationale**: Citations turn fluent evaluation into an auditable scientific artifact and allow human calibration without rereading an entire run. Keeping packet membership out of the provider schema avoids a large repeated enum while preserving exact post-response enforcement.

**Alternatives considered**: Free-form rationales were rejected because they cannot reliably distinguish inspection from invention. Line-number-only citations into rendered logs were rejected because rendering can change.

### 8. Route Three Deterministic Ledger Packets

**Decision**: Retain a complete local evidence index and compile one outcome-blind packet for each epistemic, social, and instrumental ledger per canonical origin. Projection is deterministic and non-evaluative: it pairs related tool events, removes duplicated call material, uses bounded head/tail excerpts, retains source digests, and allows evidence to appear in more than one packet when two ledgers need it. Every source item appears in at least one packet or has an explicit omission record. Each serialized packet is at most 256 KiB, and provider-free preflight fails if even the packet reference index cannot fit.

Each reviewer makes one structured call per applicable packet, serially in epistemic, social, then instrumental order. Reviewers run independently and may execute concurrently. A shared origin therefore requires six successful calls; an isolated origin requires four because social dimensions are deterministically `not-applicable`. Provider JSON contains only `schemaVersion`, an ordered `dimensions` array, a required `episodes` array, and `cautions`; packet, bundle, rubric, and ledger identity remain bound by the immutable request artifact rather than echoed by the provider. Every dimension item shares one schema and carries its `dimensionId` plus an `assessment` enum: `rated-0` through `rated-4`, `unobservable`, or `not-applicable`. Deterministic decoding restores the unchanged public state and rated-only numeric field. Non-epistemic episode arrays must be empty.

During deterministic assembly, uptake references are retained only when an earlier transmission from a different actor exists. Integration references are then retained only at or after the latest retained uptake; when no valid uptake remains, integration becomes empty. An episode labeled `supported-revision` or `asserted-only` without any revision citation is omitted in full rather than retained under an unsupported semantic label. The system does not invent, union, or otherwise expand citations. It retains the raw packet output unchanged and appends labeled assembly cautions for normalized stages and omitted episodes before ordering dimensions and cautions into the public review.

**Rationale**: The provider judges bounded evidence instead of performing pagination, cross-window citation collection, or final JSON assembly. Three focused calls reduce independent failure points and output-budget pressure while preserving ledger separation and complete, auditable routing.

**Alternatives considered**: Per-window candidate extraction plus a large integration call was rejected because one late transient failure discards many valid paid calls and the integration prompt grows with the run. One unrestricted prompt was rejected because it creates attention and context risk. Model-generated summaries without source pointers were rejected because they compound interpretation.

### 9. Add Only a Neutral Future Git Observation

**Decision**: Future `git.changed` trace events include the resolved object ID for every changed published ref. Historical runs use frozen history where unambiguous and mark event-level trajectories unavailable otherwise.

**Rationale**: Contribution, uptake, and integration claims need to connect communication and edits to a concrete shared artifact state. Capturing a ref target observes an existing event and does not prescribe a commit cadence or offer feedback.

**Alternatives considered**: Periodic forced snapshots were rejected because they impose infrastructure cadence and storage cost. Timestamp inference for historical runs was rejected as false precision.

### 10. Checkpoint Calls and Resume Explicitly

**Decision**: Add `performance` and `process-review` variants to `RunAnalysis`. Persist every validated packet response immediately and atomically under a content-addressed key covering its bundle, configuration, rubric, reviewer binding, packet, prompt, schema, and actual model identity. Retain failed calls separately with sanitized classification and message, normalized and raw finish reasons, usage availability, response identity, actual provider/model identity, whether text was returned, and returned outcome-blind text when available.

Every invocation appends a new immutable completed or incomplete analysis. `--resume <incomplete-analysis-id>` validates the named predecessor and every key field, counts predecessor usage against reviewer limits, reuses only validated completed packets, and calls each missing packet at most once. It requires new literal spend authorization and records `resumedFromAnalysisId`; it never discovers a predecessor, rewrites one, retries automatically, or imports legacy window responses. Protocol, prompt, and output-schema versions are all v4, so window-protocol and packet-protocol v1-v3 artifacts remain readable evidence but are deliberately ineligible for v4 resume.

**Rationale**: Packet-level checkpoints preserve valid paid work without weakening the no-hidden-retry rule. Append-only predecessors preserve the history of failure, authorization, usage, and recovery.

**Alternatives considered**: A database was rejected as unnecessary. Whole-review retries were rejected because they repeat paid calls and obscure failure history. Mutating an incomplete attempt or maintaining a mutable current pointer was rejected because either weakens provenance.

### 11. Keep Runtime Ownership Consistent

**Decision**: TypeScript validates artifacts, builds/redacts evidence, compiles packets, observes Git, invokes reviewers, and publishes analyses. Provider adapters expose response ID, actual identity, usage, returned text, normalized and raw finish reason, and structured-parse status whenever a response exists; transport failures remain typed and sanitized rather than becoming generic empty-output errors. Python calculates deterministic measures and batch statistics from strict requests. Reuse the existing provider adapters and Python subprocess boundary.

**Rationale**: This matches Palimpsest's current ownership rules and avoids duplicate parsing or a new service boundary.

**Alternatives considered**: An all-TypeScript grader was rejected because scoring belongs to the trusted Python research plane. A Python provider client was rejected because provider-neutral session machinery already exists in TypeScript.

### 12. Make Comparisons Explicitly Design-Aware

**Decision**: Reports require declared grouping, matching inputs, treatment field, and experimental unit. Shared runs count as team units; isolated canonical origins remain visible but are clustered under their run when estimating uncertainty. Single runs and unmatched sets are labeled descriptive.

**Rationale**: A polished dashboard can otherwise turn pseudo-replication and configuration drift into misleading model rankings.

**Alternatives considered**: Automatically inferring matched sets from convenient labels was rejected because labels are not the experimental contract. Global model leaderboards were rejected because this puzzle is not a construct-validated benchmark.

## Rubric Calibration Protocol

Before findings-bearing use, freeze the rubric version and calibration corpus. The corpus includes synthetic contrast pairs plus a stratified, redacted sample of successful, partial, unsuccessful, and behaviorally unusual real runs. Human reviewers annotate episodes and dimensions while blinded to model and outcome. Evaluate citation resolvability, leakage, observability decisions, ordinal agreement, and disagreement concentration by dimension. Revise the rubric rather than hiding dimensions with systematic disagreement, then assign a new rubric version. Green software tests validate mechanics; they do not establish construct validity.
