# Quickstart: Lean Experiment Engine

## Provider-Free Verification

```bash
pnpm exec vitest run src/config.test.ts src/records.test.ts src/build.test.ts src/run.test.ts src/evaluate.test.ts
uv run --offline --frozen --project python pytest -c python/pyproject.toml python/tests/puzzle python/tests/evaluation
pnpm verify
```

## Prepare and Validate

```bash
pnpm puzzle:build --fixture calibration-theron-ware --output artifacts/fixtures/calibration-theron-ware
pnpm puzzle:build --all true --output artifacts/fixtures
pnpm puzzle:validate --config experiments/config.yaml
```

Validation is provider-free and checks the exact manifest, prepared package digests, run/package relationships, sandbox, and smoke execution. It creates no reusable preflight receipt.

## Execute or Re-evaluate

After validation succeeds and the configured credential environment variables are available:

```bash
pnpm puzzle:experiment --config experiments/config.yaml --output artifacts/experiments/example --allow-spend true
pnpm puzzle:experiment --config experiments/config.yaml --output artifacts/experiments/example-one --run theron-ware-shared-stationary --allow-spend true
pnpm puzzle:evaluate --run-root artifacts/experiments/example/theron-ware-shared-stationary
```

The experiment command repeats validation before provider access. Inspect each run's `run.json` and `trace.jsonl`; a directory with no `run.json` is interrupted rather than complete.
