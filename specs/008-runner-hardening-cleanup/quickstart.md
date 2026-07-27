# Quickstart: Runner Hardening and Greenfield Cleanup

## Prerequisites

- Use the versions pinned in `.tool-versions`.
- Install JavaScript and Python dependencies from the independent lockfiles. A first bootstrap may use the network; `--offline` is valid only after the uv cache is populated.
- Start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --frozen --project python
pnpm puzzle:sandbox:build
```

The sandbox build may pull its pinned base image and Debian packages. It must report the expected tag, source digest, and inspected image ID. Verification itself uses the locked Python environment offline.

## Verify the Repository

```bash
pnpm verify
git diff --check
```

Verification must cover sandbox argument construction, path containment, trace reopening, reachable Git history, deterministic Python mechanics, and absence of legacy imports.

## Run the Fresh Offline Fixture

```bash
output="$(mktemp -d)/palimpsest-offline"
pnpm puzzle:offline -- --output "$output"
```

Inspect:

- `$output/attempt/trace.meta.json`
- `$output/attempt/trace.jsonl`
- `$output/attempt/attempt.json`
- `$output/attempt/overlap.json`
- `$output/attempt/evaluation/result.json`

The output path must not already exist. The evaluation must be `scored`, trace sequence must be contiguous, elapsed times must be nondecreasing, and no external model call may occur. Evaluation is one-shot because it creates `$output/attempt/evaluation/` exclusively.

## Containment Acceptance

Run the sandbox integration fixture with:

- a host sentinel outside every declared mount;
- peer and oracle sentinels;
- a fake provider credential in the host environment;
- a network connection probe; and
- ordinary clone, commit, fetch, and push operations.

Declared workspace/Git operations must succeed. Host, peer, oracle, credential, and network probes must fail. The path-containment unit tests separately cover absolute paths, parent traversal, missing and non-regular files, and symbolic-link escape.

## Greenfield Audit

```bash
test -z "$(git ls-files artifacts)"
test ! -d specs/001-foundation-evidence-protocol
test ! -d specs/005-end-to-end-harness
test -d specs/006-behavior-neutral-runner
test ! -d packages/contracts
test ! -d packages/git-accounting
test ! -d packages/git-gateway
test ! -d packages/run-control
test ! -d tools/gate-a
test ! -d tools/gate-b
test ! -d tools/gate-c
test ! -d python/src/palimpsest/gate_b
test ! -d python/src/palimpsest/gate_c
test -z "$(rg -l \
  '@palimpsest/(contracts|git-accounting|git-gateway|run-control)|palimpsest\.(contracts|gate_[bc])' \
  package.json pnpm-workspace.yaml tsconfig.json vitest.config.ts \
  packages/puzzle-runner/src tools/puzzle python/src/palimpsest/puzzle)"
```

Compare the retained specification 006 tree with `origin/main` to prove it is byte-for-byte unchanged.
