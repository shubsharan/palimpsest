# Contract: Run Controls

## Manifest

```yaml
schedule:
  releaseOffsetsMs: [0, 300000, 600000, 1200000, 1800000, 2400000]
  cutoffMs: 3600000

budgets:
  tokenBudgetPerAgent: 500000 # or null
  perAttemptMonetaryCeilingCents: 1000
  totalTokenCeiling: 37500000 # null when tokenBudgetPerAgent is null
  totalMonetaryCeilingCents: 25000
```

The values shown are an example, not the accepted-value definition.

## Valid Schedule

- exactly one offset per constructed stage
- first offset is zero
- offsets are safe, non-negative, and strictly increasing
- cutoff is a safe positive integer strictly greater than the final offset

## Token Policy

| Per-agent value | Total value | Meaning |
| --- | --- | --- |
| positive integer | positive integer | enforce cumulative per-session cutoff and total authorization |
| `null` | `null` | observe usage without token termination or token authorization |

Mixed numeric/null pairs are invalid.

## Frozen Attempt

The attempt and its protocol contain the exact resolved:

```json
{
  "releaseOffsetsMs": [0, 300000, 600000, 1200000, 1800000, 2400000],
  "cutoffMs": 3600000,
  "tokenBudgetPerAgent": 500000
}
```

`tokenBudgetPerAgent` is `null` for a time-only run. Stored decoders validate the value relationships but do not compare them to the checked-in example.
