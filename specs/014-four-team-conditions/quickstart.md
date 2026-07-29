# Quickstart: Four Team Conditions

## Verify The Condition Layer

```bash
pnpm vitest run src/condition.test.ts src/prompt.test.ts src/reveal.test.ts \
  src/activity.test.ts src/git.test.ts src/run.test.ts src/artifacts.test.ts \
  src/overlap.test.ts src/evaluate.test.ts
```

The focused suite uses fixture adapters and fake clocks. It proves exact condition mapping, prompt parity, release offsets, cutoff, shared peer visibility, isolated non-observability, topology freezing, variant-safe overlap, and selected-origin evaluation.

## Run Provider-Free Conditions

```bash
for condition in CS CR IS IR; do
  pnpm --silent puzzle:offline -- \
    --condition "$condition" \
    --output "artifacts/offline-$condition"
done
```

Each command emits one JSON object. No provider credential or live request is used.

## Inspect One Attempt

```bash
jq '{
  blockId,
  condition,
  communicationMode,
  keyRegime,
  variantId,
  releaseOffsetsMs,
  cutoffMs,
  protocolDigest,
  frozen
}' artifacts/offline-IR/attempt/attempt.json
```

For `CS`/`CR`, all workspace assignments point to one frozen repository. For `IS`/`IR`, every workspace points to its own frozen repository.

## Verify The Repository

```bash
pnpm verify
git diff --check
```

These checks are provider-free. They do not authorize a paid or findings-bearing run; that still requires a clean committed checkout and `pnpm preflight`.
