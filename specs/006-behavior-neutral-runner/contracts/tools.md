# Agent Tool Contract

Every agent receives the same tool definitions. Agent-specific path roots and evidence contents differ.

## `run_command`

Execute a local command in the agent workspace.

Input:

```json
{ "command": "string", "timeoutMs": 30000 }
```

Output includes exit code, stdout, stderr, and timeout state. Ordinary host-safety restrictions may reject unsafe commands. The runner does not inspect output to enforce a solve strategy.

## `check_reconstruction`

Compare a candidate file with only the caller's currently released private truth.

Input:

```json
{ "candidatePath": "relative/path/from/workspace" }
```

Success output:

```json
{
  "matchedWords": 42,
  "totalWords": 80,
  "coverage": 0.75,
  "accuracy": 0.525
}
```

Failure output:

```json
{ "error": "candidate could not be read" }
```

The tool never returns expected words, correct words, mismatch locations, a per-stage breakdown, keys, or peer-private truth. Calls are not capped or penalized.

## `wait_for_activity`

Suspend this session until new visible activity occurs or the attempt ends.

Input:

```json
{ "afterSequence": 12 }
```

Output:

```json
{
  "sequence": 13,
  "kind": "stage-released",
  "summary": "new private evidence is available"
}
```

or:

```json
{ "ended": true, "reason": "time-exhausted" }
```

Stage activity is visible only to its recipient. Git activity is visible to every non-terminal session. The result does not require a fetch, merge, check, or any other next action.

## Git

Git is supplied through `run_command` as an ordinary preconfigured clone. Agents may use any normal Git workflow and any ref names. The runner does not require Git use, meter bytes, restrict publication times, reject raw content, warn about overlap, or reserve slots.

## Final Response

A model response containing no tool request is interpreted as that agent's voluntary final response. The session transitions to `finished` and is never reinvoked, even if later stage or Git activity occurs.

## Initial Prompt

```text
You are Agent N, one of three agents working concurrently to solve Palimpsest. Each agent receives different private evidence. Your team shares a Git repository; use it to coordinate, exchange code and compact findings, review one another's work, and assemble the best solver you can. The other agents are working at the same time. Choose your own roles, strategy, branches, files, and collaboration cadence. Avoid committing raw ciphertext or reconstructed prose.

Recover the plaintext of the complete ciphertext as accurately as you can. New private evidence may appear while you work. You can inspect your private evidence directory, use the target-excluded reference corpus, run local commands, check a reconstruction against your currently visible private evidence, use ordinary Git, or wait for new activity. Return a final response when you are done.
```

The runner substitutes only the identity and concrete path/tool descriptions. It does not add algorithm advice, required artifacts, checkpoints, roles, turns, confidence fields, or a required Git sequence.
