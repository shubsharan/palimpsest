# CLI Contract

All commands print one final JSON object to standard output and use a non-zero exit code only for invalid operator input or infrastructure failure. Model-created outcomes such as broken code or no output are successful command executions with an evaluation status.

## `pnpm puzzle:build`

Prepare deterministic host-private puzzle inputs.

```text
pnpm puzzle:build -- \
  --output <build-directory> \
  [--seed <integer>] \
  [--stage-interval-ms <integer>] \
  [--transition-stage 4] \
  [--changed-token-mass 0.20]
```

Result:

```json
{
  "buildId": "string",
  "buildPath": "absolute path",
  "agentCount": 3,
  "stageCount": 6,
  "transitionStage": 4
}
```

The command refuses an existing non-empty output directory. It does not expose plaintext or keys in stdout.

## `pnpm puzzle:run`

Run exactly three persistent sessions.

```text
pnpm puzzle:run -- \
  --build <build-directory> \
  --output <attempt-directory> \
  --adapter <fixture|openai> \
  --token-budget <integer> \
  --wall-time-ms <integer> \
  [--model <model-name>] \
  [--fixture-scenario <name>]
```

Result:

```json
{
  "attemptId": "string",
  "frozenPath": "absolute path",
  "sessions": [
    { "agentId": "agent-1", "state": "finished", "totalTokens": 100 },
    { "agentId": "agent-2", "state": "token-exhausted", "totalTokens": 200 },
    { "agentId": "agent-3", "state": "time-exhausted", "totalTokens": 150 }
  ]
}
```

The live adapter reads provider credentials from the host environment. Credentials are never copied into attempt artifacts or agent workspaces.

## `pnpm puzzle:evaluate`

Record and execute a reviewer's selection against the complete ciphertext.

```text
pnpm puzzle:evaluate -- \
  --attempt <frozen-attempt-directory> \
  [--workspace <agent-1|agent-2|agent-3>] \
  [--command <shell-command>] \
  [--output <relative-output-path>] \
  [--notes <text>]
```

Omitting both `--command` and `--output` records `not-runnable`. Supplying only one is invalid operator input. The optional workspace selects which frozen agent worktree to inspect and execute; it defaults to `agent-1`. The selection is written before execution.

Result:

```json
{
  "status": "scored",
  "selectionPath": "absolute path",
  "resultPath": "absolute path",
  "score": {
    "matchedWords": 120,
    "totalWords": 150,
    "coverage": 1.0,
    "accuracy": 0.8
  }
}
```

## `pnpm puzzle:offline`

Build, run, freeze, and evaluate a short deterministic fixture without external model access.

```text
pnpm puzzle:offline -- --output <directory>
```

The fixture uses shortened stage and wall-time settings but exercises the same six-stage geometry, shared transition, lifecycle supervisor, ordinary Git, checker, freezing, overlap observation, and reviewer evaluation path.
