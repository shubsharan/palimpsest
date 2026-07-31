# Quickstart: Configurable Run Controls

## Provider-Free Verification

```bash
pnpm exec vitest run src/config.test.ts src/prompt.test.ts src/provider.test.ts src/session.test.ts src/run.test.ts src/artifacts.test.ts src/study.test.ts
pnpm verify
```

No live credential is required.

## Configure a Run

Edit `experiments/config.yaml`:

```yaml
schedule:
  releaseOffsetsMs: [0, 120000, 240000, 480000, 720000, 960000]
  cutoffMs: 1200000

budgets:
  tokenBudgetPerAgent: null
  perAttemptMonetaryCeilingCents: 1000
  totalTokenCeiling: null
  totalMonetaryCeilingCents: 25000
```

Resolve or use provider-free commands first. Before any paid or findings-bearing run, commit the exact configuration and run:

```bash
pnpm preflight
```

Then build and run with explicit output roots. Any later commit makes that preflight receipt stale.
