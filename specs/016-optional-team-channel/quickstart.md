# Quickstart: Optional Team Channel

## Focused Verification

```bash
pnpm exec vitest run \
  src/team-channel.test.ts src/activity.test.ts src/tools.test.ts \
  src/prompt.test.ts src/config.test.ts src/artifacts.test.ts src/run.test.ts
```

Verify:

- enabled shared sessions can post, read, and wake peers;
- disabled and isolated sessions expose no direct channel;
- accepted posts retain one complete trace event;
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
