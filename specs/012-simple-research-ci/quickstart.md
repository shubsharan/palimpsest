# Quickstart: Simple Research Verification

## Development Feedback

Install locked dependencies, then run the source check used by advisory CI:

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
pnpm check
pnpm puzzle:sandbox:build
```

CI runs these mechanical checks without unit suites, real-container behavior tests, or the offline fixture. Success does not authorize a live experiment.

## Research Preflight

Commit the exact source to test, ensure the worktree is clean, and start Docker:

```bash
git status --short
pnpm preflight
```

On success, inspect the canonical receipt at:

```text
artifacts/preflight.json
```

## Live Experiment

Run preflight once, then use the existing operator flow without changing the checkout or sandbox:

```bash
pnpm preflight

pnpm puzzle:build -- --config experiments/config.yaml --output artifacts/build-live

pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --run gpt-only \
  --build artifacts/build-live \
  --output artifacts/attempt-live
```

Before publishing findings, inspect both:

```text
artifacts/attempt-live/preflight.json
artifacts/attempt-live/attempt.json
```

The receipt must name the tested source revision and the same image identity recorded by the attempt.

## Failure Checks

A source change invalidates authorization:

```bash
touch source-drift-probe
pnpm preflight
rm source-drift-probe
```

The failed preflight leaves no `artifacts/preflight.json`. A missing, stale, dirty, or sandbox-mismatched receipt also makes a provider-backed run fail before its first provider call.
