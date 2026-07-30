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

## Single-Owner Attempt Runtime

**Decision**: Put accepted stage releases, Git changes, team messages, per-agent activity projections, and shutdown behind one serialized `AttemptRuntime`. Tools receive immutable per-agent handles; they cannot mutate buses, rooms, or release arrays directly.

**Rationale**: The previous split ownership made correctness depend on caller timing: a close could race a post, a checker could observe a release array changing across an `await`, and trace/activity/message projections could drift. One owner validates and durably observes each mutation before synchronously updating every in-memory projection, orders shutdown after already queued work, and poisons the whole runtime if its canonical trace cannot accept an event.

**Alternatives considered**: Additional guards in each caller were rejected because they preserve multiple authorities and new interleavings. A database, event broker, replay engine, or actor service was rejected because one local serialized promise tail provides the required ordering at attempt scale.

## Published Code As A Complete Operation

**Decision**: `runPublishedSolver` owns the full deadline-bound operation: initialize a fresh host-owned temporary repository, fetch only literal `refs/heads/main`, resolve and check out that pinned object, remove Git metadata, execute the solver, validate and evaluate its output, clean every temporary capture, and only then return a typed identity/outcome. Checker and final evaluation publish results only after this return.

**Rationale**: Materializing before identity publication eliminates the mutable-ref interval. Owning execution, trusted evaluation, and cleanup as well prevents callers from retaining a temporary path, publishing success before cleanup, or converting a trusted evaluator failure into a model submission outcome.

**Alternatives considered**: More path guards around the in-workspace checker were rejected because the live agent filesystem would remain inside the grading boundary. A public callback or returned snapshot handle was rejected because cleanup and publication ordering would remain caller obligations. A mirror, daemon, database, or permanent duplicate submission tree was rejected because the short-lived complete operation and sealed frozen repository already provide the required execution and durable provenance boundaries.

## Ordered Released Input

**Decision**: Stage publication creates ordered records containing ordinal, sealed build source, and visible copied path. Checker ciphertext reads only those source records and inserts one newline between already newline-terminated stages; Python checker truth uses the identical geometry.

**Rationale**: The release event, not an agent-writable directory scan, is the authority for what is visible. One canonical separator rule retains the intended blank paragraph boundary without accumulating extra newlines.

**Alternatives considered**: Rescanning evidence filenames was rejected because visible directories are not the release authority and name matching creates ambiguity. Concatenating bytes without a separator and joining with two newlines were rejected because both change cross-stage paragraph geometry.

## One Short-Lived Solver Execution Profile

**Decision**: Both checking and evaluation use one host-owned runner and the existing short-lived Docker sandbox implementation. The container receives a read-only submission tree, read-only ciphertext, one writable output directory, read-only root filesystem, bounded `/tmp`, no network, and no Git, evidence, reference, workspace-parent, oracle, or credential mounts.

**Rationale**: Checker and evaluation differ only in ciphertext scope and scoring hook. One execution primitive prevents their visibility and output rules from drifting.

**Alternatives considered**: The persistent agent lease was rejected because it intentionally exposes private evidence, reference material, Git, and the live workspace. A separate grader image or service was rejected because the existing puzzle sandbox already contains the required runtime and limits.

## Exact Commit And Honest Boundary Identity

**Decision**: Checker feedback reports the exact captured commit. Final selection and result records retain the reviewer workspace, assigned repository, canonical main ref, and captured commit. The immutable scoring declaration uses `selected-workspace-main-snapshot-v1`.

**Rationale**: The old `manual-workspace-command-output-v1` identifier describes controls the evaluator no longer accepts. A new frozen identifier makes the changed scientific boundary explicit and invalidates stale design receipts through the existing digest.

**Alternatives considered**: A compatibility alias was rejected because it would misstate the executed protocol. Renaming the manifest field was rejected because `reviewerSelectionId` still accurately names the operator's workspace choice and changing the field adds no validity.
