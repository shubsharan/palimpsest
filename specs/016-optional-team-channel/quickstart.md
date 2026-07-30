# Quickstart: Optional Team Channel

## Focused Verification

```bash
pnpm exec vitest run \
  src/attempt-runtime.test.ts src/published-solver.test.ts src/activity.test.ts src/tools.test.ts \
  src/prompt.test.ts src/config.test.ts src/artifacts.test.ts src/run.test.ts
```

Verify:

- enabled shared sessions can post, read, and wake peers;
- disabled and isolated sessions expose no direct channel;
- accepted posts retain one complete trace event;
- post-versus-close and release-versus-check races produce one ordered outcome;
- mode changes alter manifest/protocol identities without changing solver grading.

## Provider-Free Acceptance

```bash
pnpm puzzle:offline -- \
  --condition CR \
  --output artifacts/offline-team-channel
```

The checked-in manifest enables the room for the next run. Change only:

```yaml
communication:
  teamChannel: disabled
```

to restore the Git-only shared condition for a paired test.

## Full Verification

```bash
pnpm verify
git diff --check
```

After committing the feature, run `pnpm preflight` before any provider-backed attempt.

## Published Solver Boundary

1. Publish a valid `solver.py` and any imported helpers to the assigned origin's `main`.
2. Leave a different candidate uncommitted and publish another candidate on a non-main branch.
3. Repoint the bare repository's symbolic `HEAD` to the non-main branch.
4. Run `check_published_solver` and confirm it reports the exact `refs/heads/main` commit.
5. While the captured solver is running, force-push `main` to unrelated history and confirm execution still uses the reported commit.
6. Freeze and evaluate the selected workspace.
7. Confirm selection identifies the workspace, assigned repository, canonical main ref, and captured commit before solver execution starts, while completion/result records appear only after capture cleanup.
8. Confirm the solver environment contains no `.git`, `/git`, `/evidence`, `/reference`, workspace parent files, oracle paths, or provider credentials.

Expected result: checker and evaluation run one complete capture-execute-evaluate-clean operation over the exact Git-free main tree regardless of workspace state, later force-pushes, other refs, or symbolic `HEAD`; no result is published before cleanup succeeds.

## Output Containment

Exercise solvers that produce no output, an empty file, an escaping symlink, a directory, and a file larger than 16 MiB.

Expected result: every invalid candidate is rejected before checking or scoring. A normal contained reconstruction remains scoreable.
