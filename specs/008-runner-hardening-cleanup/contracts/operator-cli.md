# Operator CLI Compatibility Contract

The four existing puzzle commands keep their flag names, required/optional relationships, one-object JSON stdout, and nonzero failure behavior. The sandbox build command is additive.

## `puzzle:build`

Required:

- `--output <path>`

Optional defaults:

- `--seed 0`
- `--stage-interval-ms 120000`
- `--transition-stage 4`
- `--changed-token-mass 0.2`

Success output retains `buildId`, `buildPath`, `agentCount`, `stageCount`, and `transitionStage`.

## `puzzle:run`

Required:

- `--build <path>`
- `--output <path>`
- `--adapter fixture|openai`
- `--token-budget <positive integer>`
- `--wall-time-ms <positive integer>`

Conditional and optional:

- `--model <name>` is required for `openai`.
- `--fixture-scenario <name>` remains optional for `fixture`.

Success output retains the attempt result, `attemptRoot`, `buildRoot`, and overlap observation. Sandbox identity and trace metadata are additive fields.

## `puzzle:evaluate`

Required:

- `--attempt <path>`

Optional:

- `--workspace agent-1|agent-2|agent-3`, defaulting to `agent-1`
- paired `--command <shell source>` and `--output <workspace-relative path>`
- `--notes <text>`

Command and output remain an all-or-neither pair. Success output retains `scored`, `not-runnable`, `no-output`, and `execution-error` statuses. Infrastructure detail is additive.

## `puzzle:offline`

Required:

- `--output <path>`

The command performs one deterministic fixture build, run, overlap observation, sandboxed evaluation, and score without an external model call. Success output retains `build`, `run`, and `evaluation`.

## `puzzle:sandbox:build`

No flags are required. The command builds the supported local tag with source labels, inspects it, and emits one JSON object containing `imageTag`, `imageId`, `sourceDigest`, and `profileVersion`.
