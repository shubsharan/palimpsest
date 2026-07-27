# Operator CLI Compatibility Contract

The refactor preserves all five `pnpm puzzle:*` script names and routes them through one private dispatcher. The dispatcher change is not operator-visible.

## Shared Rules

- A leading standalone `--` is accepted.
- Flags remain name/value pairs; missing values and duplicate names fail explicitly.
- Existing unrelated unknown-flag behavior is not tightened globally.
- Success emits exactly one JSON object followed by one newline on standard output.
- Failure emits no success-shaped JSON, reports through standard error, and exits nonzero.
- Existing absolute result paths remain absolute.

## `pnpm puzzle:sandbox:build`

No flags are required.

Success fields:

- `imageTag`
- `imageId`
- `sourceDigest`
- `profileVersion`

The command builds the supported local image, validates its source label, inspects its immutable identity, and returns that identity.

## `pnpm puzzle:build`

Required:

- `--output <path>`

Optional defaults:

- `--seed 0`
- `--stage-interval-ms 120000`
- `--transition-stage 4`
- `--changed-token-mass 0.2`

Success fields:

- `buildId`
- `buildPath`
- `agentCount`
- `stageCount`
- `transitionStage`

The output destination must be absent or empty. Nonempty output fails without modifying its existing content.

## `pnpm puzzle:run`

Required:

- `--build <path>`
- `--output <path>`
- `--adapter fixture|openai`
- `--token-budget <positive integer>`
- `--wall-time-ms <positive integer>`

Conditional and optional:

- `--model <name>` is required for `openai`.
- `--fixture-scenario <name>` defaults to `collaborative-revision` for `fixture`.
- `collaborative-revision` is the only accepted fixture scenario; every unknown supplied name fails before sandbox or attempt side effects.

Success fields:

- `attemptId`
- `sessions`
- `frozen`
- `tracePath`
- `traceMetadataPath`
- `sandbox`
- `attemptRoot`
- `buildRoot`
- `overlap`

If optional post-freeze overlap observation fails, the command remains nonzero and emits no success result, but the completed `attempt.json`, trace, and frozen work remain available for `puzzle:evaluate`.

## `pnpm puzzle:evaluate`

Required:

- `--attempt <path>`

Optional:

- `--workspace agent-1|agent-2|agent-3`, default `agent-1`
- paired `--command <shell source>` and `--output <workspace-relative path>`
- `--notes <text>`

`--attempt` accepts the attempt root or its `frozen/` child. `--command` and `--output` remain an all-or-neither pair.

Result statuses:

- `scored`
- `not-runnable`
- `no-output`
- `execution-error`

Optional `selection`, `execution`, `outputPath`, `score`, and `error` fields remain governed by the existing status semantics.

## `pnpm puzzle:offline`

Required:

- `--output <path>`

The fixed scenario remains:

- seed `0`
- 20 ms stage interval
- transition stage `4`
- changed token mass `0.2`
- `collaborative-revision`
- token budget `100`
- wall time `10000` ms
- reviewer workspace `agent-1`
- command `sh solve.sh`
- output `reconstruction.txt`
- existing reviewer notes

Success fields:

- `build`
- `run`
- `evaluation`

The command performs build, three-agent run, overlap observation, evaluation, and scoring without an external model call.
