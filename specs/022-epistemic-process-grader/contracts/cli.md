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
  [--resume <incomplete-process-review-analysis-id>] \
  --allow-spend true
```

- Requires an exact valid `performance` analysis and unchanged source digest.
- Rejects absent or non-literal `--allow-spend true` before provider construction.
- Validates two reviewer profiles from distinct provider families, each with a cumulative `tokenLimit` and per-call `maxOutputTokens`.
- Compiles the same bounded epistemic, social, and instrumental packets for both reviewers, never exposing run/model identity or final outcome. Every source item is routed at least once or receives an explicit individual or content-addressed batch omission; oversized reference sets use deterministic head/tail retention rather than quality-based selection.
- Calls each reviewer's packets serially in epistemic, social, then instrumental order while allowing the two reviewers to run independently. A shared origin makes six calls; an isolated origin makes four and receives deterministic `not-applicable` social dimensions.
- Uses protocol v6 provider JSON containing `schemaVersion`, bounded structured `claims`, ordered advisory `dimensions`, required `episodes`, and `cautions`. Claims bind to deterministic `opp-NNNN` opportunities and compact `cNNN` citations. Assembly assigns claim IDs by array order, remaps dimension references, and normalizes structurally inconsistent actor scope with labeled cautions. Dimension rationales are rendered deterministically from assembled claim IDs.
- Requires `episodes: []` from social and instrumental packets. It checkpoints every success or failure immediately, accounts provider-reported input plus output usage, conservatively normalizes unsupported uptake/integration links, omits asserted or supported revision episodes without revision citations, and assembles each public review deterministically. Raw packet output remains unchanged and normalization adds labeled stage/count and episode-omission cautions. There is no model integration or adjudication call.
- Appends `status: completed` only when both reviews validate. Provider errors or invalid reviews remain an explicit `status: incomplete` analysis and are not findings-bearing.
- Retains a response that crosses its reviewer's cumulative token limit, publishes the attempt incomplete, and makes no further call for that reviewer.
- Without `--resume`, every invocation starts a new attempt and never discovers or reuses earlier work.
- With `--resume`, requires an immutable incomplete protocol-v6 predecessor with exact source, bundle, configuration, rubric, reviewer, packet, prompt, schema, opportunity, and actual-identity agreement. Protocol v5 cannot resume into v6.
- Resume requires literal `--allow-spend true` again and appends a new analysis with predecessor lineage; it never rewrites the predecessor. All pre-v6 analyses are readable but not resumable into v6.
- Does not average ratings, force consensus, automatically retry, or automatically adjudicate. Literal spend authorization is not a monetary billing cap.

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
- The report configuration declares descriptive versus matched-contrast intent, inclusion filters, grader/rubric/review-protocol identities, matching fields, treatment field, experimental unit, and clustering rule. `reviewProtocol: ledger-packets-v6` selects evidence-dossier scorecards when historical reviews coexist.
- Rejects matched-contrast mode if material inputs differ outside the declared treatment or if required analysis versions differ.
- Excludes incomplete, censored, invalid, and missing analyses with explicit reasons.
- Reports per-dimension distributions, uncertainty, missingness, reviewer disagreement, and process-outcome links; it emits no composite score or global leaderboard.
- Scorecard-v2 reports lead with mechanisms and opportunity-conditioned rates, followed by provenance, layered failure accounts, typed disagreement, and advisory rating distributions.

## `puzzle:calibrate`

```bash
pnpm puzzle:calibrate --artifacts-root <root> --output <new-directory>
```

Scans contained scorecard-v2 artifacts and atomically publishes provider-free structural-integrity and reviewer-stability metrics. It makes no provider calls and explicitly does not establish construct validity. Any fresh review used to populate a calibration set remains a separate `puzzle:review --allow-spend true` action.

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

The system derives analysis IDs, ledger packets, short packet-local citation IDs, prompt structure, strict output schemas, content-addressed artifact keys, provider credentials, paths, digests, and publication order. Reviewer profiles must resolve through existing local model configuration and must belong to distinct provider families.

## Exit Semantics

- `0`: requested artifact published and validated.
- Non-zero: no success-shaped result. Diagnostics identify configuration, artifact, leakage, citation, provider, finish reason, structured parsing, token-limit, resume, spend-authorization, or publication failure.
- An incomplete paid review is an explicit published observation but exits non-zero so automation cannot mistake it for a findings-bearing grade.
