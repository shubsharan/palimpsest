# Quickstart: Runner Hardening and Greenfield Cleanup

## Prerequisites

- Use the versions pinned in `.tool-versions`.
- Install JavaScript and Python dependencies from the independent lockfiles.
- Start Docker Engine or Docker Desktop.

```bash
pnpm install --frozen-lockfile
uv sync --offline --frozen --project python
pnpm puzzle:sandbox:build
```

The sandbox build command must report the expected tag, source digest, and inspected image ID.

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

The evaluation must be `scored`, trace sequence must be contiguous, elapsed times must be nondecreasing, and no external model call may occur.

## Containment Acceptance

Run the sandbox integration fixture with:

- a host sentinel outside every declared mount;
- peer and oracle sentinels;
- a fake provider credential in the host environment;
- a workspace symlink aimed at a host sentinel;
- a network connection probe; and
- ordinary clone, commit, fetch, and push operations.

Declared workspace/Git operations must succeed. Host, peer, oracle, credential, network, and symlink-escape probes must fail.

## Greenfield Audit

```bash
test -z "$(git ls-files artifacts)"
test ! -d specs/001-foundation-evidence-protocol
test ! -d specs/005-end-to-end-harness
test -d specs/006-behavior-neutral-runner
rg 'git-accounting|git-gateway|run-control|contracts:compare|gate-[abc]' \
  package.json pnpm-workspace.yaml tsconfig.json vitest.config.ts packages tools tests python \
  && exit 1 || true
```

Compare the retained specification 006 tree with `origin/main` to prove it is byte-for-byte unchanged.
