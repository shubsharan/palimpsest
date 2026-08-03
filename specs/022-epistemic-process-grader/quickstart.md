# Quickstart: Epistemic Process Grader

This workflow is the planned operator contract. It does not spend money until the explicit review step.

## 1. Verify the Development Surface

```bash
pnpm verify
```

This is provider-free advisory evidence. It is not findings-bearing validation and does not authorize a review.

## 2. Grade One Completed Run Provider-Free

```bash
pnpm puzzle:grade --run-root artifacts/experiments/<experiment>/<run>
```

Inspect the returned analysis ID and the files under:

```text
artifacts/experiments/<experiment>/<run>/grading/<performance-analysis-id>/
```

Confirm that:

- the evidence manifest covers the retained trace and explicitly lists redactions or omissions;
- mechanical measures expose eligibility, denominator, and missingness;
- existing `run.json` evaluations and trace bytes are unchanged;
- the new `performance` analysis points to the exact detail digest.

No provider credential is read in this step.

## 3. Validate a Qualitative Review Configuration

Prepare one strict configuration with a frozen rubric and two distinct-provider reviewer profiles:

```yaml
schemaVersion: 1
rubric: epistemic-process-v1
models:
  reviewer-openai:
    provider: openai
    model: gpt-5.6-sol
  reviewer-anthropic:
    provider: anthropic
    model: claude-opus-5
reviewers:
  - profile: reviewer-openai
    tokenLimit: 500000
    maxOutputTokens: 8000
  - profile: reviewer-anthropic
    tokenLimit: 500000
    maxOutputTokens: 8000
```

The review command validates the completed run, exact performance analysis, source digest, deterministic ledger packets, the 256 KiB packet limit, complete routing/omission accounting, leakage rules, reviewer distinction, credentials, cumulative token limits, and per-call output limits before provider construction.

## 4. Run the Explicitly Authorized Review

```bash
pnpm puzzle:review \
  --run-root artifacts/experiments/<experiment>/<run> \
  --config grading/epistemic-process-v1.yaml \
  --performance-analysis <performance-analysis-id> \
  --allow-spend true
```

The literal authorization permits paid calls for only the two declared reviewers; it is not a monetary billing cap. For each shared origin, the system makes one epistemic, social, and instrumental call per reviewer: six calls total. For each isolated origin it skips social review, deterministically marks those dimensions `not-applicable`, and makes four calls. Each reviewer proceeds in epistemic/social/instrumental order, while the reviewers remain independent and may run concurrently.

Every valid response or failure is checkpointed immediately. Protocol v4 provider JSON contains only `schemaVersion`, ordered `dimensions`, required `episodes`, and `cautions`; the immutable call request supplies packet, bundle, rubric, digest, and ledger identity. Each dimension uses one shared shape with a scalar `assessment` value (`rated-0` through `rated-4`, `unobservable`, or `not-applicable`), which deterministically decodes to the unchanged public state and rated-only numeric field. Citation fields remain compact `cNNN` string arrays; token syntax is schema-checked and exact dimension order and packet membership are checked after parsing. Social and instrumental packets must return `episodes: []`. Provider-reported input and output usage accumulates independently per reviewer. A response that crosses `tokenLimit` is retained, the attempt becomes incomplete, and no further call or automatic retry occurs for that reviewer. Every individual response is capped by `maxOutputTokens`.

The system assembles each review deterministically and makes no final model integration call. It suppresses uptake without an earlier transmission from a different actor, then suppresses integration before the latest retained uptake or all integration when no valid uptake remains. It omits a whole `supported-revision` or `asserted-only` episode if no revision citation supports that status. It never invents citations: the raw response remains unchanged and the assembled review receives labeled cautions naming each normalized stage/count and omitted episode ID/status. Both completed process judgments freeze before the existing outcome is linked.

Inspect:

```text
artifacts/experiments/<experiment>/<run>/grading/<process-review-analysis-id>/
```

Verify that both reviews retain citations, confidence, counterevidence, and separate ratings; disagreement is visible; and `scorecard.json` contains distinct outcome, epistemic, social, and instrumental sections with no composite.

If the command publishes an incomplete packet-protocol analysis, resume only that named attempt:

```bash
pnpm puzzle:review \
  --run-root artifacts/experiments/<experiment>/<run> \
  --config grading/epistemic-process-v1.yaml \
  --performance-analysis <performance-analysis-id> \
  --resume <incomplete-process-review-analysis-id> \
  --allow-spend true
```

Resume validates the predecessor and every source, configuration, rubric, reviewer, packet, prompt, schema, and actual-identity key. It reuses only validated completed packets, counts their usage against the reviewer limit, calls only missing or failed packets once, and appends a new analysis with `resumedFromAnalysisId`. It does not rewrite the predecessor or auto-discover an attempt. Only `ledger-packets-v4` artifacts with matching `ledger-packet-prompt-v4` and `ledger-packet-output-v4` identities are eligible; window-protocol and packet-protocol v1-v3 analyses remain readable but cannot resume.

## 5. Produce a Cross-Run Report

```bash
pnpm puzzle:report \
  --artifacts-root artifacts/experiments/<experiment> \
  --config grading/report-example.yaml \
  --output artifacts/reports/<report-id>
```

Use descriptive mode for exploratory collections. Use matched-contrast mode only when the report configuration declares the treatment and all required non-treatment input fields. Inspect included and excluded runs, missingness, per-dimension distributions, reviewer agreement, clustering, uncertainty, and process-outcome associations before making claims.

## 6. Calibrate Before Findings-Bearing Use

Run the rubric against the frozen calibration corpus, then audit a stratified sample without model or outcome identity. Confirm citation resolvability, leakage resistance, observability decisions, and per-dimension reviewer agreement. If anchors change, issue a new rubric version and re-review; never silently reinterpret an existing analysis.

## Expected Boundaries

- A trace-only interrupted directory can be described as censored but cannot be graded as completed.
- A failed or invalid packet remains an incomplete analysis and is not retried automatically; recovery requires an explicit named resume and new spend authorization.
- Stored failure details distinguish overload, refusal, empty output, length exhaustion, filtering, malformed JSON, schema validation, and transport failure when the provider exposes the required metadata.
- Old traces lacking event-time commit IDs report the affected trajectory measures as unavailable.
- A single run may illustrate a mechanism but cannot establish a stable model trait or causal collaboration effect.
- Green grading tests prove mechanical behavior, not construct validity.
- This quickstart records provider-free and fake-adapter verification only; it does not claim that a live provider review has succeeded.
