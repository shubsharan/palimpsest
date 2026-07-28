# Quickstart: Configurable Research Runs

## Install and verify

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
pnpm puzzle:sandbox:build
pnpm verify
```

Verification and offline execution must not require live provider credentials.

## Inspect the baseline manifest

`experiments/config.yaml` declares the current Middlemarch chapters, Jane Eyre and Moby-Dick references, three agents, six stages, one stage-four partial re-key, fixture-sized limits, and one live-model example condition per supported driver.

Credential fields name environment variables; the file contains no key values.

## Build only

```bash
build_root="$(mktemp -d)/build"
pnpm puzzle:build -- \
  --config experiments/config.yaml \
  --output "$build_root"
```

Inspect `$build_root/puzzle-build.json` for the resolved scientific inputs, dynamic agent/stage geometry, and re-key array.

## Run one live condition

Set only the environment variable named by the selected provider, then run:

```bash
attempt_root="$(mktemp -d)/attempt"
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --run gpt-only \
  --build "$build_root" \
  --output "$attempt_root"
```

The command performs no fallback or hidden retry. A provider or usage failure is retained as infrastructure outcome.

## Run declared conditions

```bash
experiment_root="$(mktemp -d)/experiment"
pnpm puzzle:experiment -- \
  --config experiments/config.yaml \
  --output "$experiment_root"
```

Inspect:

- `$experiment_root/experiment.json`
- `$experiment_root/build/puzzle-build.json`
- `$experiment_root/attempts/<run-name>/<NNN>/attempt.json`
- each attempt trace, frozen workspaces, and optional overlap

## Review and evaluate

After inspecting a frozen attempt:

```bash
pnpm puzzle:evaluate -- \
  --attempt "$experiment_root/attempts/<run-name>/001" \
  --workspace agent-1 \
  --command "sh solve.sh" \
  --output-path reconstruction.txt
```

The experiment runner does not choose these values.

## Validate failure boundaries

- Add an unknown key: validation fails before the output root exists.
- Make a mixed run's model list disagree with `agentCount`: validation fails before build.
- Select the target as a reference: validation fails before build.
- Change a registered corpus byte: digest validation fails before puzzle publication.
- Remove a selected credential environment variable: live run fails before attempt creation.
- Inject a failure after one durable attempt: the earlier attempt and last `experiment.json` remain readable.

## Offline acceptance

```bash
output="$(mktemp -d)/palimpsest-offline"
pnpm puzzle:offline -- --output "$output"
```

This proves the variable-geometry builder, dynamic sessions, Git, sandbox, trace, overlap, reviewer evaluation, and scoring path without a billable provider call.
