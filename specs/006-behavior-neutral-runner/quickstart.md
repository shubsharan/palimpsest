# Quickstart: Behavior-Neutral Multi-Agent Puzzle Runner

## Prerequisites

- Node.js 26.5.0
- pnpm 10.14.0
- Python 3.12.4
- uv 0.11.14
- Git 2.48 or newer

Install the locked dependencies once:

```bash
pnpm install --frozen-lockfile
uv sync --offline --frozen --project python
```

## Run The Offline Experiment

```bash
pnpm puzzle:offline -- --output artifacts/puzzle/offline-quickstart
```

The command builds one deterministic six-stage puzzle, runs three scripted persistent agents against private evidence and one ordinary shared Git remote, freezes the attempt, executes the fixture solver against the complete ciphertext, and writes an evaluation.

Inspect:

```text
artifacts/puzzle/offline-quickstart/
├── build/
├── attempt/
│   ├── trace.jsonl
│   ├── shared.git/
│   └── frozen/
└── evaluation/
```

The final JSON result must report three terminal session states and an evaluation status. The trace must explain stage releases, lifecycle transitions, checker calls, Git changes, termination reasons, reviewer selection, execution, overlap observations, and score.

## Run A Live Experiment

First build an attempt:

```bash
pnpm puzzle:build -- --output artifacts/puzzle/builds/example
```

Then run it with host credentials:

```bash
pnpm puzzle:run -- \
  --build artifacts/puzzle/builds/example \
  --output artifacts/puzzle/attempts/example \
  --adapter openai \
  --model <model-name> \
  --token-budget 100000 \
  --wall-time-ms 3600000
```

The three sessions begin concurrently. They know peers exist and that Git is the supplied collaboration channel, but no Git operation, role, turn, checkpoint, or intermediate artifact is required.

After the attempt freezes, inspect the repository and record the command you want evaluated:

```bash
pnpm puzzle:evaluate -- \
  --attempt artifacts/puzzle/attempts/example/frozen \
  --command '<reviewer-selected command>' \
  --output '<reviewer-selected output path>'
```

If there is no plausible runnable solver, record that without manufacturing an entrypoint:

```bash
pnpm puzzle:evaluate -- --attempt artifacts/puzzle/attempts/example/frozen
```

## Verify

```bash
pnpm test:ts -- tests/puzzle packages/puzzle-runner
pnpm test:py -- python/tests/puzzle
pnpm puzzle:offline -- --output artifacts/puzzle/verification
pnpm verify
git diff --check
```

The live provider path is not required for offline verification. A cached or historical harness result does not count as evidence for this feature.
