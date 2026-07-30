# Contract: Four-Condition Runtime

## Condition Decoder

```text
CS -> shared, stationary
CR -> shared, rekey
IS -> isolated, stationary
IR -> isolated, rekey
```

No alias, case conversion, trimming, boolean flag, or independent treatment input is supported.

## Schedule

```json
{
  "releaseOffsetsMs": [0, 300000, 600000, 1200000, 1800000, 2400000],
  "cutoffMs": 3600000
}
```

Stage one is present before model sessions open. Later stages are published when the monotonic clock reaches their exact offset. Reaching the cutoff aborts the schedule and active sessions.

## Git Topology

Shared:

```text
git/
├── shared.git
└── workspaces/
    ├── agent-1/ -> shared.git
    ├── agent-2/ -> shared.git
    └── agent-3/ -> shared.git
```

Isolated:

```text
git/
├── agent-1.git
├── agent-2.git
├── agent-3.git
└── workspaces/
    ├── agent-1/ -> agent-1.git
    ├── agent-2/ -> agent-2.git
    └── agent-3/ -> agent-3.git
```

Each workspace's `origin` is `/git/origin.git`. Each sandbox lease mounts only the assigned host repository there. Shared ref changes are visible to all agents. Isolated ref changes are visible only to the owner. Stage activity is always private.

## Prompt Shape

Common identity:

```text
You are Agent N, one of 3 agents working concurrently as one team. Each agent receives different private evidence.
```

Shared channel paragraph:

```text
Three agents, one team submission: origin/main:solver.py. There are no individual submissions or scores. Collaborate through the team's shared Git repository: publish useful solver changes, inspect peer commits, compare approaches, and integrate the strongest work. A local commit is visible to peers only after you push it. Git does not count against your model-token budget.
```

Isolated channel paragraph:

```text
Peer communication is unavailable. Your assigned origin is private and no peer can see its commits or score. Publish your strongest solver to origin/main:solver.py so it remains part of the team record. Git does not count against your model-token budget.
```

The remaining objective, word-substitution cipher disclosure, schedule, cutoff, token limit, tools, paths, references, published-solver checker, wait behavior, evaluation boundary, and final-response request are byte-identical. Every origin begins at the same neutral `solver.py` commit. The prompt contains no key-regime term, oracle label, expected score, assigned role, decoding algorithm, prescribed branch strategy, workflow, checkpoint, required intermediate file, or raw-sharing warning.

`check_published_solver` takes no candidate path. It captures the exact current `origin/main` commit, checks it out cleanly, runs `python3 solver.py` against only the caller's released evidence, and returns the commit with aggregate matched words, total words, coverage, and accuracy or an execution error. Final grading uses the same interface against the complete ciphertext.

## Attempt Schema Version 3

```json
{
  "schemaVersion": 3,
  "attemptId": "attempt-...",
  "blockId": "calibration-theron-ware",
  "condition": "CR",
  "communicationMode": "shared",
  "keyRegime": "rekey",
  "variantId": "rekey",
  "buildId": "build-<sha256>",
  "buildRoot": "/absolute/build",
  "agentIds": ["agent-1", "agent-2", "agent-3"],
  "releaseOffsetsMs": [0, 300000, 600000, 1200000, 1800000, 2400000],
  "cutoffMs": 3600000,
  "tokenBudgetPerAgent": 200000,
  "protocolDigest": "<sha256>",
  "protocol": {},
  "tracePath": "/absolute/trace.jsonl",
  "traceMetadataPath": "/absolute/trace.meta.json",
  "frozen": {
    "root": "/absolute/frozen",
    "communicationMode": "shared",
    "repositories": [],
    "workspaces": []
  },
  "sandbox": {},
  "sessions": []
}
```

The decoder rejects unknown fields, non-canonical treatment values, condition/variant mismatches, schedule drift, topology drift, digest mismatch, or build-manifest mismatch.

## CLI

```bash
pnpm puzzle:run -- --config experiments/config.yaml --run mixed \
  --condition CR --build artifacts/build --output artifacts/attempt

pnpm puzzle:experiment -- --config experiments/config.yaml \
  --condition CR --output artifacts/experiment

pnpm puzzle:offline -- --condition CR --output artifacts/offline-cr
```

`--condition` is required and strict. F014 does not add arbitrary mode/regime flags or condition arrays to schema v1.

## Observation And Evaluation

Overlap resolves the paired-build variant from `attempt.condition`. Shared mode scans one repository. Isolated mode scans each repository once and prefixes its committed paths with the owning agent ID before aggregation.

Manual evaluation requires an explicit workspace selection and mounts its recorded repository. It never merges repositories or chooses a solver automatically.
