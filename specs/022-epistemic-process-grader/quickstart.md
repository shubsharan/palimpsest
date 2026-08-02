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
reviewers:
  - profile: reviewer-a
    spendCeilingCents: 300
  - profile: reviewer-b
    spendCeilingCents: 300
```

The review command validates the completed run, exact performance analysis, source digest, evidence-bundle leakage rules, reviewer distinction, credentials, and ceilings before provider construction.

## 4. Run the Explicitly Authorized Review

```bash
pnpm puzzle:review \
  --run-root artifacts/experiments/<experiment>/<run> \
  --config grading/epistemic-process-v1.yaml \
  --performance-analysis <performance-analysis-id> \
  --allow-spend true
```

The literal authorization applies only to the two declared reviewer ceilings. Each judge sees the same blinded evidence and returns an independent review. The system freezes both process judgments before linking the existing outcome.

Inspect:

```text
artifacts/experiments/<experiment>/<run>/grading/<process-review-analysis-id>/
```

Verify that both reviews retain citations, confidence, counterevidence, and separate ratings; disagreement is visible; and `scorecard.json` contains distinct outcome, epistemic, social, and instrumental sections with no composite.

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
- A failed or invalid judge remains an incomplete analysis and is not retried automatically.
- Old traces lacking event-time commit IDs report the affected trajectory measures as unavailable.
- A single run may illustrate a mechanism but cannot establish a stable model trait or causal collaboration effect.
- Green grading tests prove mechanical behavior, not construct validity.
