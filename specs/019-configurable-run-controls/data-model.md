# Data Model: Configurable Run Controls

## Run Controls

- `releaseOffsetsMs`: exactly six safe non-negative integers
- `cutoffMs`: positive safe integer
- `tokenBudgetPerAgent`: positive safe integer or `null`
- `perAttemptMonetaryCeilingCents`: non-negative safe integer
- `totalTokenCeiling`: positive safe integer or `null`
- `totalMonetaryCeilingCents`: non-negative safe integer

Validation:

- `releaseOffsetsMs[0]` is zero.
- Every later offset is greater than its predecessor.
- `cutoffMs` is greater than the final release.
- Release count equals the selected build stage count.
- Token per-agent and total fields are both numeric or both `null`.
- Numeric total token authorization covers the primary matrix and explicit replacements.
- Monetary total authorization always covers the primary matrix and explicit replacements.

## Resolved Run Controls

The validated, non-secret run controls copied into:

- resolved manifest and immutable-manifest digest
- prompt snapshots and protocol digest
- design receipt and phase adjustment records
- launch reservation and cumulative authorization
- configured trace event
- attempt summary and protocol snapshot

State:

1. `declared`: researcher-authored manifest values
2. `resolved`: structurally and relationally valid values
3. `receipt-bound`: committed source, sandbox, build, prompt, and controls frozen
4. `reserved`: one attempt authorization appended before provider work
5. `published`: immutable attempt records the controls and actual usage

No transition permits changing controls inside an active attempt.

## Token Policy

### Enabled

- `tokenBudgetPerAgent`: positive integer
- `totalTokenCeiling`: positive integer
- session may terminate as `token-exhausted`
- launch reservation has numeric authorized tokens

### Disabled

- `tokenBudgetPerAgent`: `null`
- `totalTokenCeiling`: `null`
- session cannot terminate from cumulative usage
- launch reservation and cumulative authorized tokens are `null`
- actual input/output usage remains numeric

## Returned Reasoning Summary Evidence

Discriminated states:

- `captured`
  - `items`: ordered list
  - each item has a non-empty provider item `id`
  - each item has ordered `summary` entries
  - each entry is `{ type: "summary_text", text: string }`
- `response-body-unavailable`

The normalized optional `reasoningSummary` remains a separate model-turn field. Unsupported providers omit returned OpenAI summary evidence.
