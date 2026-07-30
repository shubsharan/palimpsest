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
