# Contract: Optional Team Channel

## Manifest

```yaml
schemaVersion: 3
communication:
  teamChannel: enabled # enabled | disabled
```

The field is required and immutable for a study. `enabled` affects only shared conditions.

## Agent Tools

Tools exist only in shared conditions when the declared mode is `enabled`.

### `post_team_message`

Input:

```json
{ "message": "Let's compare the repeated three-letter tokens before changing solver.py." }
```

Output:

```json
{ "sequence": 1, "author": "agent-2", "occurredAtMs": 1234.5 }
```

`message` must be trimmed, non-empty, and at most 4,000 characters. Author is derived from the calling session.

### `read_team_messages`

Input:

```json
{ "afterSequence": 0 }
```

Output:

```json
{
  "messages": [
    {
      "sequence": 1,
      "author": "agent-2",
      "message": "Let's compare the repeated three-letter tokens before changing solver.py.",
      "occurredAtMs": 1234.5
    }
  ],
  "latestSequence": 1,
  "nextSequence": 1,
  "hasMore": false
}
```

Each read returns at most 20 messages in increasing sequence.

## Activity

An accepted post publishes:

```json
{
  "kind": "team-message",
  "detail": { "messageSequence": 1, "author": "agent-2" }
}
```

`wait_for_activity` summarizes this as new team discussion being available. The activity sequence and message sequence are distinct cursors.

## Attempt Runtime

One serialized attempt runtime owns the room together with released-stage and Git activity projections. An accepted post is appended to the canonical trace before it becomes readable or wakes any peer; after acceptance, every eligible peer receives the projection synchronously. A trace failure accepts nothing, poisons the runtime, aborts the attempt, and ends every activity waiter. Shutdown is ordered after already queued posts and rejects every later mutation. Agent tools receive only an author-bound handle and cannot publish activity or choose message authorship.

## Trace

Each accepted post appears once:

```json
{
  "kind": "team.message",
  "data": {
    "sequence": 1,
    "author": "agent-2",
    "message": "Let's compare the repeated three-letter tokens before changing solver.py.",
    "occurredAtMs": 1234.5
  }
}
```

Ordinary `tool.started` and `tool.completed` records retain reads and failures. No message receives a score or changes the solver submission.

## Prompt

- Shared/enabled: disclose the room and both tools as an optional strategy channel; state that Git `main:solver.py` remains the team submission.
- Shared/disabled: preserve the current Git-only prompt.
- Isolated: preserve the current no-peer prompt regardless of manifest mode.
