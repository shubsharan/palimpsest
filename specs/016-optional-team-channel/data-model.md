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
2. One attempt runtime creates private release/activity projections and, for shared/enabled attempts, one empty room.
3. A stage release, Git change, or eligible post validates and synchronously commits every affected live projection, then appends one event to the ordered trace outbox.
4. Reads return ordered pages without changing room state.
5. Shutdown rejects later mutation immediately, waits for the trace outbox, and then ends every private activity stream. A trace failure poisons the attempt, so an unprojected live commit cannot become valid evidence.

Agent tools receive only an immutable per-agent handle. Released-stage snapshots are copied and frozen before asynchronous checker work; activity buses, room storage, and runtime mutation methods are never exposed.

## Published Solver Snapshot

Represents the exact submitted code used by checker feedback or final evaluation.

- `repositoryId`: condition-assigned origin selected for the caller or reviewer workspace.
- `ref`: canonical literal `refs/heads/main`.
- `commit`: resolved 40-character commit object identity.
- `root`: host-created temporary directory containing the complete exported commit tree and no Git metadata.

Validation: one deadline-bound operation fetches only literal main into a private ref and materializes it before publishing `commit`; the exported root remains outside all agent workspaces and never escapes the operation; execution continues to use the captured tree if main advances or is force-pushed. The operation executes, validates, evaluates, removes all temporary state, and only then returns a typed outcome.

## Released Stage

- `ordinal`: contiguous one-based publication order.
- `sourcePath`: sealed build-stage source trusted by checker assembly.
- `visiblePath`: copied agent-visible evidence representation.

Validation: the source is copied into host-private staging first. Publication atomically renames it to `visiblePath` and appends the record/activity in one synchronous live commit; trace projection follows through the ordered outbox. Canonical checker input reads ordered `sourcePath` values only and inserts one newline between newline-terminated stages; it never rescans `visiblePath` directories.

## Solver Execution

- `submission`: captured Published Solver Snapshot identity.
- `ciphertextPath`: trusted host file containing released or complete ciphertext.
- `outputRoot`: fresh empty host directory used only by trusted extraction and never mounted into the solver.
- `outputScratch`: fresh 16 MiB container tmpfs mounted at `/output`.
- `execution`: bounded sandbox exit, timeout, overflow, stdout, and stderr fields.
- `outputPath`: contained canonical reconstruction path when present.

Validation: submission and ciphertext are read-only; Git, agent workspaces, evidence, references, oracle files, credentials, and writable host paths are absent. After exit, only the declared output is copied to hidden host staging. It must be a regular non-empty file no larger than 16 MiB before atomic rename into `outputRoot`.

Execution returns a discriminated success or submission-error outcome only after cleanup. Trusted host-process, evaluator, sandbox, mount, cleanup, and cancellation failures are infrastructure errors and do not become normal solver results.

## Evaluation Submission Selection

- `workspace`: explicit canonical reviewer-selected agent workspace.
- `repositoryId`: repository assigned to that workspace by frozen condition topology.
- `ref`: canonical literal `refs/heads/main`.
- `commit`: exact captured commit.
- `command`: canonical `python3 solver.py`.
- `outputPath`: canonical `reconstruction.txt`.
- optional non-empty `notes`.

Shared workspaces select the same repository; isolated workspaces select their own. Checker and evaluation share snapshot and execution rules but use different ciphertext assembly and scoring hooks.
