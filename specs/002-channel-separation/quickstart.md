# Quickstart: Channel Separation Gate A

## Prerequisite

Milestone 1 must remain reproducible:

```bash
pnpm verify
pnpm evidence:gate-report -- artifacts/milestone-1/gate-report.json
```

## Verify the accounting codec

```bash
pnpm gate-a:codec
```

This runs golden binary vectors, decode/re-encode properties, malformed-frame rejection, logical Git OID verification, reachability/visibility properties, and peer-visible mutation probes.

## Verify native Git invariance

```bash
pnpm gate-a:git-invariance
```

This materializes the same logical transactions through the predeclared pack order, delta, compression, thin-pack, and client profiles and requires byte-identical accounting frames.

## Build frozen inputs

```bash
pnpm gate-a:inputs
```

This writes only canonical, license/provenance-bound opaque shard geometries, common side information, useful-state checkpoints, Git genesis, and strategy manifests. It does not run judged attacks.

## Predeclare Gate A

```bash
pnpm gate-a:predeclare
pnpm evidence:gate-report -- artifacts/gate-a/predeclaration.json
```

Inspect the input digests, strategy matrix, 120-slot capacity model, 4–64 KiB sweep, exact environment, and decision rule before proceeding.

## Run judged evidence

```bash
pnpm gate-a:run
```

Every strategy runs in a fresh network-disabled attempt and promotes only an exact declared artifact. The command refuses input, implementation, environment, or predeclaration drift.

## Complete and replay the report

```bash
pnpm gate-a:complete
pnpm gate-a:replay
pnpm evidence:gate-report -- artifacts/gate-a/gate-report.json
```

Replay resolves every digest, recomputes exact reconstruction verdicts, cumulative frame charges, timing credit, sweep classifications, extrema, interval, and decision from raw artifacts.
