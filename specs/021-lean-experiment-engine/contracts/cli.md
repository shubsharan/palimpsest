# CLI Contract

All commands emit one JSON result on success and fail non-zero with diagnostics.

## Build Derived Packages

```bash
pnpm puzzle:build --config <manifest.yaml> [--run <run-id>]
```

The command decodes schema v2, derives package identities and paths, and atomically prepares every run's package or the selected named run. Identical derived packages are built once. Existing non-empty output paths are never overwritten.

## Validate an Experiment

```bash
pnpm puzzle:validate --config <manifest.yaml>
```

Validation strictly decodes every run and derived package, rejects missing or drifted package bytes, probes the sandbox once, and smoke-runs the first declared run. It never resolves credentials or opens provider sessions.

## Execute an Experiment

```bash
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --allow-spend true
pnpm puzzle:experiment --config <manifest.yaml> --output <experiment-dir> --run <run-id> --allow-spend true
```

Without `--run`, named runs execute sequentially in map order; agents within a run execute concurrently. With `--run`, only that map key executes and supplies the smoke run. Missing spend authorization fails before sandbox work. Exact validation repeats before provider access, and authorization cannot exceed the sum of the selected runs' declared ceilings.

A session infrastructure result lets peers quiesce before freezing and evaluation, publishes an infrastructure-error record when possible, and stops later runs. No failure triggers retry, replacement, peer cancellation, merge, repair, or resume.

## Re-evaluate and Analyze

```bash
pnpm puzzle:evaluate --run-root <run-dir>
pnpm puzzle:analyze --run-root <run-dir> [--minimum-words <n>]
```

Both commands are provider-free. They strictly validate the current record, canonical trace, fixture digest, topology, and frozen trees before atomically appending one typed history entry.
