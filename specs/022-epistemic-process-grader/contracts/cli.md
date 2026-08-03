# CLI Contract: Epistemic Process Grader

All commands are local. Success prints one JSON object to stdout. Invalid input, ineligible artifacts, provider failure, or publication failure writes a diagnostic to stderr and exits non-zero. No command retries automatically.

## `puzzle:grade`

Build the blinded evidence index, compute deterministic measures, and append a `performance` analysis.

```bash
pnpm puzzle:grade --run-root <run-dir> [--config <grading.yaml>]
```

- Provider-free and credential-free.
- Requires a valid completed `run.json`, trace, fixture relationship, contained frozen topology, and tree seal.
- Defaults to the checked-in grading configuration when `--config` is omitted.
- Rejects a duplicate analysis identity for the same source/configuration digest.
- Creates `grading/<analysis-id>/evidence.json`, `metrics.json`, and `manifest.json`, then appends the strict analysis reference to `run.json`.
- Never changes evaluations, trace, run status, frozen files, or existing analyses.

Success shape:

```json
{
  "runRoot": "artifacts/experiments/example/run-a",
  "analysisId": "performance-...",
  "kind": "performance",
  "detailsPath": "grading/performance-.../manifest.json",
  "originCount": 1
}
```

## `puzzle:review`

Run two independent outcome-blind qualitative reviews and append a `process-review` analysis.

```bash
pnpm puzzle:review \
  --run-root <run-dir> \
  --config <grading.yaml> \
  --performance-analysis <analysis-id> \
  --allow-spend true
```

- Requires an exact valid `performance` analysis and unchanged source digest.
- Rejects absent or non-literal `--allow-spend true` before provider construction.
- Validates two reviewer profiles from distinct provider families, each with a cumulative `tokenLimit` and per-call `maxOutputTokens`.
- Supplies both judges the same blinded bundle and rubric, never the run/model identity or final outcome.
- Writes each raw response before validation, accounts provider-reported input plus output usage, validates strict structure and every evidence citation, then freezes the two reviews before joining existing outcome facts.
- Appends `status: completed` only when both reviews validate. Provider errors or invalid reviews remain an explicit `status: incomplete` analysis and are not findings-bearing.
- Retains a response that crosses its reviewer's cumulative token limit, publishes the attempt incomplete, and makes no further call for that reviewer.
- Does not average ratings, force consensus, or automatically retry. Literal spend authorization is not a monetary billing cap.

Success shape:

```json
{
  "runRoot": "artifacts/experiments/example/run-a",
  "analysisId": "process-review-...",
  "kind": "process-review",
  "status": "completed",
  "reviewCount": 2,
  "detailsPath": "grading/process-review-.../manifest.json"
}
```

## `puzzle:report`

Create a provider-free cross-run behavior report without mutating source runs.

```bash
pnpm puzzle:report \
  --artifacts-root <experiment-or-artifacts-dir> \
  --config <report.yaml> \
  --output <report-dir>
```

- Discovers only run records under the supplied contained root.
- The report configuration declares descriptive versus matched-contrast intent, inclusion filters, matching fields, treatment field, experimental unit, and clustering rule.
- Rejects matched-contrast mode if material inputs differ outside the declared treatment or if required analysis versions differ.
- Excludes incomplete, censored, invalid, and missing analyses with explicit reasons.
- Reports per-dimension distributions, uncertainty, missingness, reviewer disagreement, and process-outcome links; it emits no composite score or global leaderboard.

Success shape:

```json
{
  "reportId": "behavior-report-...",
  "claimType": "matched-contrast",
  "includedRunCount": 24,
  "excludedRunCount": 3,
  "path": "reports/behavior-report-.../report.json"
}
```

## Grading Configuration

One strict YAML file declares only useful review choices; construction details are derived.

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

The system derives analysis IDs, evidence windows, prompt structure, output schema, provider credentials, paths, digests, and publication order. Reviewer profiles must resolve through existing local model configuration and must belong to distinct provider families.

## Exit Semantics

- `0`: requested artifact published and validated.
- Non-zero: no success-shaped result. Diagnostics identify configuration, artifact, leakage, citation, provider, token-limit, spend-authorization, or publication failure.
- An incomplete paid review is an explicit published observation but exits non-zero so automation cannot mistake it for a findings-bearing grade.
