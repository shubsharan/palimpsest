# Quickstart: Foundation and Evidence Protocol

## Supported environment

Use the exact versions recorded in `.tool-versions`: Node.js 26.5.0, pnpm 10.14.0, Python 3.12.4, uv 0.11.14, and Git 2.48.1. Verification intentionally refuses a different evidence-producing toolchain.

## Synchronize pinned dependencies

```bash
corepack pnpm install --frozen-lockfile
uv sync --project python --frozen
```

The pnpm and uv dependency graphs remain separate. Their lockfiles are committed independently.

## Run the full Milestone 1 verification

```bash
pnpm verify
```

The command checks exact versions, formatting, linting, TypeScript types and tests, Python checks and tests, cross-runtime fixture verdicts, canonical JSON and archive bytes, deterministic artifact promotion, all injected failure modes, retry isolation, and generated-evidence consistency.

## Reproduce the evidence bundle

```bash
pnpm evidence:milestone-1
```

The command starts from frozen fixtures and requests, writes to a fresh temporary attempt directory, and promotes only a fully verified result into `artifacts/milestone-1/`. Running it twice must produce the same canonical artifact bytes and SHA-256 digest.

## Exercise one expected failure

```bash
pnpm evidence:reference-producer --mode digest-mismatch
```

The command must exit unsuccessfully, record a failed attempt, and leave the promoted namespace unchanged. Failure injection is evidence for the promotion boundary, not a successful artifact.

## Validate a gate report

```bash
pnpm evidence:gate-report -- artifacts/milestone-1/gate-report.json
```

A `predeclared` report must contain the question, immutable inputs, thresholds, and pass/rework/stop criteria with no result. A `completed` report must preserve the predeclaration digest and add digest-addressed raw artifacts, environment and producer versions, analysis, result, and follow-up.

## Clean-checkout reproduction

From a fresh checkout, install only from the committed lockfiles, then run `pnpm verify`. No network is used by validation, tests, producers, or artifact replay after dependency synchronization. Dependency download is not part of an evidence-producing attempt.

Maintainers can exercise the same clean-source procedure from the working repository:

```bash
pnpm verify:clean-snapshot
```

This copies only source-controlled and non-ignored source files into a temporary repository, creates a frozen revision, installs both dependency graphs offline from their lockfiles, runs `pnpm verify`, requires the temporary source tree to remain clean, and writes the canonical result to `artifacts/milestone-1/clean-snapshot.json`.
