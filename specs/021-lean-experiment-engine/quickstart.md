# Quickstart: Lean Experiment Engine

## Bootstrap and Verify

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
pnpm verify
```

`verify` is the fast provider-free development gate. With Docker running, `pnpm verify:full` adds material, acceptance, image-build, and representative Docker lanes.

## Edit the Experiment

Edit only `experiments/config.yaml`. Its run map keys are the run IDs:

```yaml
schemaVersion: 2
name: theron-ware-unlimited-1h
models:
  sol:
    provider: openai
    model: gpt-5.6-sol
    reasoningEffort: medium
runs:
  shared:
    source: fixtures/corpus/fortunes-fool.txt
    agents: 3
    model: sol
    communication: shared
    releases: [0m, 5m, 10m, 20m, 30m, 40m]
    cutoff: 1h
    spendCeilingCents: 1000
```

Add `rekeyAtStage` only for a re-keyed run and `tokenLimitPerAgent` only when a token cap is part of the design. The engine derives everything else, including `OPENAI_API_KEY` for the example provider.

## Prepare and Validate

```bash
pnpm puzzle:build --config experiments/config.yaml
pnpm puzzle:build --config experiments/config.yaml --run shared
pnpm puzzle:validate --config experiments/config.yaml
```

Build publishes deterministic packages beneath `artifacts/fixtures/`. Validation rejects missing or drifted packages, probes the sandbox, and runs one provider-free smoke path. It cannot open a provider session.

## Execute or Re-evaluate

```bash
pnpm puzzle:experiment --config experiments/config.yaml --output artifacts/experiments/example --allow-spend true
pnpm puzzle:experiment --config experiments/config.yaml --output artifacts/experiments/example-one --run shared --allow-spend true
pnpm puzzle:evaluate --run-root artifacts/experiments/example/shared
pnpm puzzle:analyze --run-root artifacts/experiments/example/shared
```

Only `puzzle:experiment` can open provider sessions. It rejects missing explicit spend authorization before sandbox work and repeats exact validation before access. Inspect each run's `run.json` and `trace.jsonl`; a directory without `run.json` is interrupted rather than complete.
