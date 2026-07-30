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

**Decision**: Put accepted stage releases, Git changes, team messages, per-agent activity projections, and shutdown behind one `AttemptRuntime`. Each operation makes one synchronous live commit across every affected in-memory view, then enters one ordered durable trace outbox. Tools receive immutable per-agent handles; they cannot mutate buses, rooms, or release arrays directly.

**Rationale**: The previous split ownership made correctness depend on caller timing, while using trace I/O as the runtime lock made scheduled evidence visibility depend on unrelated message and Git traffic. JavaScript synchronous execution supplies the live atomic commit; the outbox preserves identical trace order without delaying treatment state. Shutdown rejects new commits immediately and drains the outbox. A trace failure poisons the attempt, so only a fully projected attempt can become valid research evidence.

**Alternatives considered**: Additional guards in each caller were rejected because they preserve multiple authorities and new interleavings. Making the trace append the live commit was rejected because storage latency then changes treatment timing. A database, event broker, replay engine, or actor service was rejected because one in-process owner and one promise-tail outbox provide the required ordering at attempt scale.

## Published Code As A Complete Operation

**Decision**: `runPublishedSolver` owns the full deadline-bound operation: initialize a fresh host-owned temporary repository, fetch only literal `refs/heads/main`, resolve and check out that pinned object, remove Git metadata, execute the solver, validate and evaluate its output, clean every temporary capture, and only then return a typed identity/outcome. Checker and final evaluation publish results only after this return.

**Rationale**: Materializing before identity publication eliminates the mutable-ref interval. Owning execution, trusted evaluation, and cleanup as well prevents callers from retaining a temporary path, publishing success before cleanup, or converting a trusted evaluator failure into a model submission outcome.

**Alternatives considered**: More path guards around the in-workspace checker were rejected because the live agent filesystem would remain inside the grading boundary. A public callback or returned snapshot handle was rejected because cleanup and publication ordering would remain caller obligations. A mirror, daemon, database, or permanent duplicate submission tree was rejected because the short-lived complete operation and sealed frozen repository already provide the required execution and durable provenance boundaries.

## Ordered Released Input

**Decision**: Stage publication first copies each sealed source into host-private staging on the evidence filesystem. The runtime atomically renames that file into the agent-visible evidence directory while committing the ordered release record and activity. Checker ciphertext reads only those records and inserts one newline between already newline-terminated stages; Python checker truth uses the identical geometry.

**Rationale**: Private preparation prevents partial files; same-filesystem rename makes visibility atomic; and the runtime commit keeps visible bytes, the released-stage view, and activity aligned without waiting behind trace persistence. The release event, not an agent-writable directory scan, remains the authority for checking. One canonical separator rule retains the intended blank paragraph boundary without accumulating extra newlines.

**Alternatives considered**: Copying directly into evidence was rejected because partial or uncommitted bytes become visible. Rescanning evidence filenames was rejected because visible directories are not the release authority and name matching creates ambiguity. Concatenating bytes without a separator and joining with two newlines were rejected because both change cross-stage paragraph geometry.

## One Short-Lived Solver Execution Profile

**Decision**: Both checking and evaluation use one host-owned runner and the existing short-lived Docker sandbox implementation. The container receives a read-only submission tree, read-only ciphertext, a 16 MiB `/output` tmpfs, read-only root filesystem, bounded `/tmp`, no network, and no Git, evidence, reference, workspace-parent, oracle, credential, or writable host mounts. After exit, the host copies only the declared path to hidden staging, validates it, and atomically renames a valid file into durable output.

**Rationale**: The tmpfs quota bounds hostile or accidental writes while they occur. Hidden extraction and atomic rename ensure unvalidated bytes never occupy the durable output path. Checker and evaluation differ only in ciphertext scope and scoring hook, so one execution primitive prevents their visibility and output rules from drifting.

**Alternatives considered**: A writable host bind plus post-run `stat` was rejected because it lets untrusted code consume host storage before validation. The persistent agent lease was rejected because it intentionally exposes private evidence, reference material, Git, and the live workspace. A separate grader image or service was rejected because the existing puzzle sandbox already contains the required runtime and limits.

## Exact Commit And Honest Boundary Identity

**Decision**: Checker feedback reports the exact captured commit. Final selection and result records retain the reviewer workspace, assigned repository, canonical main ref, and captured commit. The immutable scoring declaration uses `selected-workspace-main-snapshot-v1`.

**Rationale**: The old `manual-workspace-command-output-v1` identifier describes controls the evaluator no longer accepts. A new frozen identifier makes the changed scientific boundary explicit and invalidates stale design receipts through the existing digest.

**Alternatives considered**: A compatibility alias was rejected because it would misstate the executed protocol. Renaming the manifest field was rejected because `reviewerSelectionId` still accurately names the operator's workspace choice and changing the field adds no validity.
