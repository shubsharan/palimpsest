# Research: Optional Team Channel

## Explicit Per-Test Mode

**Decision**: Add one required manifest field with exactly `enabled` or `disabled`, and enable it in the checked-in next-run configuration.

**Rationale**: An explicit immutable selection prevents silent defaults and makes paired Git-only/direct-channel tests distinguishable in receipts and attempts.

**Alternatives considered**: A CLI flag was rejected because it could contradict the strict manifest. Inferring the mode from condition IDs was rejected because the operator needs both Git-only and direct-channel shared tests.

## Shared Conditions Only

**Decision**: An enabled channel is exposed only when the canonical condition communication mode is shared. Isolated conditions expose no message tool, content, or wake activity.

**Rationale**: The existing condition defines peer visibility. Allowing messages in isolated cells would invalidate that treatment and leak peer behavior.

**Alternatives considered**: Private self-only channels were rejected because they add a different tool with no experimental value. Enabling the room in isolated mode was rejected as contradictory.

## One Public Append-Only Room

**Decision**: Use one attempt-local in-memory room with canonical agent authorship, increasing message sequence, attempt-relative time, 4,000-character content limit, and fixed 20-message read pages.

**Rationale**: A public room supports strategy discussion with the smallest inspectable state. Bounded posts and reads prevent one tool result from consuming unbounded context.

**Alternatives considered**: Direct messages were rejected because they fragment the team record and complicate visibility. Files, Git notes, services, queues, databases, and sockets were rejected as unnecessary.

## Separate Post And Read Tools

**Decision**: Expose `post_team_message({message})` and `read_team_messages({afterSequence})` only to eligible sessions.

**Rationale**: Two narrow contracts are clearer than an action-dispatch tool and let agents retain their own read cursor without prescribed turns.

**Alternatives considered**: Automatically injecting messages into model context was rejected because it creates interrupts and hidden scheduling effects. A single overloaded tool was rejected as harder to validate.

## Activity And Trace Integration

**Decision**: Every accepted post publishes a `team-message` activity event to eligible peers and appends one `team.message` record to the canonical attempt trace. The message room itself is not a separate artifact.

**Rationale**: Existing wait and trace boundaries already provide wakeups and durable chronology. A second transcript file would duplicate authority.

**Alternatives considered**: Poll-only reads were rejected because waiting agents would miss timely discussion. A separate message database or log was rejected because JSONL already provides the complete durable record.

## Schema Evolution

**Decision**: Advance the strict study manifest to schema version 3 and the nested attempt protocol snapshot to version 2. Keep outer attempt and design receipt versions unchanged because their top-level shapes do not change.

**Rationale**: Both modified contracts gain a new required identity field and intentionally reject undeclared legacy inputs. Existing whole-manifest and design digests bind the mode automatically.

**Alternatives considered**: An optional field or implicit disabled default was rejected because old and new tests would be ambiguous. Compatibility decoding was rejected by the project's greenfield contract policy.

## Published Code As An Exported Commit Snapshot

**Decision**: Resolve the assigned origin's `refs/heads/main` to an exact commit on the trusted host, export that commit's complete tree without Git metadata, and make the exported tree the sole code input to checker and evaluation execution.

**Rationale**: A clone inside an agent workspace can observe unpublished siblings, while a clone of a bare repository can follow mutable symbolic `HEAD` or expose other refs at runtime. An exported exact commit is the smallest artifact that directly represents the declared submission.

**Alternatives considered**: More path guards around the in-workspace checker were rejected because the live agent filesystem would remain inside the grading boundary. A `--branch main` clone retaining the origin mount was rejected because submitted code could still inspect other Git objects. A permanent duplicate submission tree was rejected because the sealed frozen repository already provides durable source provenance.

## One Short-Lived Solver Execution Profile

**Decision**: Both checking and evaluation use one host-owned runner and the existing short-lived Docker sandbox implementation. The container receives a read-only submission tree, read-only ciphertext, one writable output directory, read-only root filesystem, bounded `/tmp`, no network, and no Git, evidence, reference, workspace-parent, oracle, or credential mounts.

**Rationale**: Checker and evaluation differ only in ciphertext scope and scoring hook. One execution primitive prevents their visibility and output rules from drifting.

**Alternatives considered**: The persistent agent lease was rejected because it intentionally exposes private evidence, reference material, Git, and the live workspace. A separate grader image or service was rejected because the existing puzzle sandbox already contains the required runtime and limits.

## Exact Commit And Honest Boundary Identity

**Decision**: Checker feedback reports the exact captured commit. Final selection and result records retain the reviewer workspace, assigned repository, canonical main ref, and captured commit. The immutable scoring declaration uses `selected-workspace-main-snapshot-v1`.

**Rationale**: The old `manual-workspace-command-output-v1` identifier describes controls the evaluator no longer accepts. A new frozen identifier makes the changed scientific boundary explicit and invalidates stale design receipts through the existing digest.

**Alternatives considered**: A compatibility alias was rejected because it would misstate the executed protocol. Renaming the manifest field was rejected because `reviewerSelectionId` still accurately names the operator's workspace choice and changing the field adds no validity.
