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
