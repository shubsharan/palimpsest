# Quickstart: Frozen Five-Block Protocol

## Verify Without Providers

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run src/config.test.ts src/study.test.ts src/artifacts.test.ts src/experiment.test.ts
pnpm exec vitest run tests/puzzle/cli.test.ts tests/puzzle/offline.test.ts tests/puzzle/experiment.test.ts
pnpm verify
```

The provider-free coordinator acceptance constructs the five receipt-bound builds and executes the four calibration plus sixteen validation cells. The retained offline acceptance separately runs the unchanged three-session attempt with fixture adapters and a fake clock. Neither requires provider credentials or makes a provider request.

## Inspect The Frozen Matrix

```bash
pnpm puzzle:experiment -- --config experiments/config.yaml --phase calibration --study-root /tmp/palimpsest-study
pnpm puzzle:experiment -- --config experiments/config.yaml --phase validation --study-root /tmp/palimpsest-study
```

Provider-backed use requires a current clean receipt-bound preflight. Calibration publishes `/tmp/palimpsest-study/design.json` before the first session. Validation refuses to start until calibration is complete and the receipt-bound builds remain intact.

Expected primary attempts:

- calibration: 4
- validation: 16
- total: 20

## Explicit Replacement

After a phase stops on a frozen attempt classified `session-infrastructure-error`:

```bash
pnpm puzzle:experiment -- --config experiments/config.yaml --phase validation --study-root /tmp/palimpsest-study --replace <attempt-id>
pnpm puzzle:experiment -- --config experiments/config.yaml --phase validation --study-root /tmp/palimpsest-study
```

The first command appends one cited replacement. The second resumes with the next unstarted primary cell only after the replacement succeeds. No command automatically retries a cell.

## Inspect Artifacts

```bash
python -m json.tool /tmp/palimpsest-study/design.json
python -m json.tool /tmp/palimpsest-study/calibration/phase.json
python -m json.tool /tmp/palimpsest-study/validation/phase.json
```

Confirm:

- receipt publication predates the first calibration attempt;
- all five build-manifest digests match;
- calibration and validation cell order is exact;
- only the two declared operational budget values can differ in validation;
- cumulative authorization, actual usage, and replacement lineage are explicit;
- no phase record applies the rubric, selects a result, or aggregates scores.
