# Data Model: Optional Team Channel

## Team Channel Mode

- `enabled`: shared conditions receive the room and message tools.
- `disabled`: all conditions retain their existing tool surface.

Validation: exactly one mode is required in the strict manifest. The resolved and immutable manifests, design digest, prompt snapshots, and attempt protocol retain it.

## Team Message

- `sequence`: positive safe integer, unique and increasing within one attempt.
- `author`: canonical `agent-1`, `agent-2`, or `agent-3`.
- `message`: trimmed non-empty text of at most 4,000 characters.
- `occurredAtMs`: finite non-negative attempt-relative time.

Validation: authorship comes from the session identity, never model input. A rejected post consumes no sequence and produces no accepted-message event.

## Team Message Page

- `messages`: up to 20 messages whose sequence is greater than `afterSequence`.
- `latestSequence`: sequence of the newest accepted message in the room, or zero.
- `nextSequence`: sequence of the final returned message, or the caller's cursor when empty.
- `hasMore`: whether another read from `nextSequence` would return messages.

Validation: `afterSequence` is a non-negative safe integer and may exceed the current latest sequence, returning an empty page.

## Team Message Activity

- ordinary activity-bus sequence;
- kind `team-message`;
- attempt-relative time;
- detail containing only the message sequence and author.

The activity is visible to every eligible shared agent and to no isolated agent. Message content is read through the team-channel tool and retained in the canonical trace.

## State Transitions

1. Attempt declares mode.
2. Shared/enabled runtime creates one empty room; other attempts create none.
3. An eligible post validates, receives the next sequence, becomes readable, emits trace and activity.
4. Reads return ordered pages without changing room state.
5. Attempt termination prevents further model tool calls; the frozen trace remains authoritative.

## Published Solver Snapshot

Represents the exact submitted code used by checker feedback or final evaluation.

- `repositoryId`: condition-assigned origin selected for the caller or reviewer workspace.
- `ref`: canonical literal `refs/heads/main`.
- `commit`: resolved 40-character commit object identity.
- `root`: host-created temporary directory containing the complete exported commit tree and no Git metadata.

Validation: one deadline-bound transaction fetches only literal main into a private ref and materializes it before publishing `commit`; the exported root remains outside all agent workspaces and exists only for the callback; execution continues to use the captured tree if main advances or is force-pushed.

## Released Stage

- `ordinal`: contiguous one-based publication order.
- `sourcePath`: sealed build-stage source trusted by checker assembly.
- `visiblePath`: copied agent-visible evidence representation.

Validation: publication appends the record only after the visible copy succeeds. Canonical checker input reads ordered `sourcePath` values only and inserts one newline between newline-terminated stages; it never rescans `visiblePath` directories.

## Solver Execution

- `submission`: captured Published Solver Snapshot identity.
- `ciphertextPath`: trusted host file containing released or complete ciphertext.
- `outputRoot`: fresh empty host directory mounted as the only writable durable output.
- `execution`: bounded sandbox exit, timeout, overflow, stdout, and stderr fields.
- `outputPath`: contained canonical reconstruction path when present.

Validation: submission and ciphertext are read-only; Git, agent workspaces, evidence, references, oracle files, and credentials are absent; successful output resolves inside `outputRoot`, is a regular non-empty file, and does not exceed 16 MiB.

Execution returns a discriminated success or submission-error outcome. Trusted host-process, sandbox, mount, cleanup, and cancellation failures are infrastructure errors and do not become normal solver results.

## Evaluation Submission Selection

- `workspace`: explicit canonical reviewer-selected agent workspace.
- `repositoryId`: repository assigned to that workspace by frozen condition topology.
- `ref`: canonical literal `refs/heads/main`.
- `commit`: exact captured commit.
- `command`: canonical `python3 solver.py`.
- `outputPath`: canonical `reconstruction.txt`.
- optional non-empty `notes`.

Shared workspaces select the same repository; isolated workspaces select their own. Checker and evaluation share snapshot and execution rules but use different ciphertext assembly and scoring hooks.
