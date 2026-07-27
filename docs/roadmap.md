# Palimpsest Roadmap

## Purpose

This roadmap delivers Palimpsest as a playable three-agent decipherment puzzle. The proposal defines the puzzle and interpretation. The architecture defines the minimal runner and visibility boundaries. The active Spec Kit feature turns those decisions into implementation tasks.

The delivery order follows usable behavior: build the puzzle, let agents work freely, let them check their work, evaluate what they leave behind, and remove machinery that does not serve those behaviors.

## Current Status

Feature 006 defines the active behavior-neutral runner. The current implementation work establishes three persistent concurrent sessions, private six-stage evidence streams, one hidden shared partial re-key, ordinary shared Git, aggregate checking, token and wall-time cutoffs, reviewer-selected final execution, and raw observational traces.

The project is complete when the documented build-run-evaluate path works end to end and the runner neither prescribes nor repairs agent collaboration.

## Delivery Sequence

### 1. Align the Puzzle

Keep one current explanation of:

- the word-substitution puzzle;
- three private contiguous shard streams;
- six clock-driven stages;
- the hidden shared partial re-key;
- the explicit joint-team and Git prompt;
- voluntary collaboration and unconstrained strategy;
- aggregate private checking;
- token and wall-time termination;
- reviewer-selected evaluation; and
- limited research claims.

The constitution, proposal, architecture, roadmap, active specification, plan, tasks, runtime guidance, and operator commands must describe the same behavior.

### 2. Build Playable Evidence

Deliver `puzzle:build`.

- Reuse deterministic text preparation, cipher, partial re-key, sharding, and scoring primitives where they match the active design.
- Produce three private six-stage streams with useful evidence before and after the shared transition.
- Keep earlier stages immutable and keep the transition hidden from agent-visible names and metadata.
- Store private evidence and the oracle outside Git and agent workspaces until release.
- Prepare the complete ciphertext for final execution.

This step is done when repeated fixture builds reproduce the stage bytes, transition, checker truth, and complete evaluation input.

### 3. Run the Team

Deliver `puzzle:run`.

- Start exactly three independent persistent model sessions.
- Tell every agent that two peers are working concurrently with different evidence and that Git is the shared team channel.
- Provide equivalent local tools, reference data, ordinary Git, aggregate checking, and activity waiting.
- Release six private stages on one monotonic schedule independent of model behavior.
- Wake waiting sessions on private-stage or peer-visible Git activity without synchronizing the team.
- Allow unlimited response, tool, checker, and Git cycles within cumulative per-agent token budgets and one global wall-time cutoff.
- Freeze the repository and workspaces when the run ends.

This step is done when independent work, continuous collaboration, waiting, voluntary completion, individual token exhaustion, and global time exhaustion all complete without rounds, roles, checkpoints, or required Git actions.

### 4. Check, Evaluate, and Observe

Deliver `puzzle:evaluate` and the private checker.

- Return only matched-word count, total-word count, coverage, accuracy, or a plain error for currently visible private evidence.
- Let a reviewer inspect frozen work and record the selected command and output path before execution.
- Run the selected solver against the complete ciphertext without oracle or public-network access.
- Report `scored`, `not-runnable`, `no-output`, or `execution-error`.
- Preserve raw model/tool activity, stage chronology, checker aggregates, Git history, termination, reviewer selection, execution, and scores.
- Report only obvious exact or normalized raw overlap after the run, without blocking, warning, rescoring, or invalidating.

This step is done when successful, partial, missing, ambiguous, broken, raw-sharing, repeated-checking, and no-Git fixtures all remain inspectable outcomes.

### 5. Simplify the Active Surface

Make the three canonical commands the project entrypoints:

```bash
pnpm puzzle:build
pnpm puzzle:run
pnpm puzzle:evaluate -- --attempt <attempt-path>
```

Keep code that directly supports generation, staged delivery, sessions, Git, checking, observation, evaluation, and scoring. Remove active command paths and runtime dependencies whose purpose is Git byte accounting, publication slots, structured hypotheses, private deliverables, exact artifact replay, gate authorization, adversarial compression, hostile-solver promotion, or red-team release.

The repository may retain research results and numbered feature records as evidence of completed work. Current product docs, runtime guidance, package scripts, and code paths must describe only the active puzzle.

### 6. Verify the Puzzle Path

Run proportional verification:

- format and link checks for current documentation;
- Python unit and property tests for build, partial re-key, checker, overlap observer, and scorer;
- TypeScript tests for prompt neutrality, session independence, stage timing, wake behavior, Git, cutoffs, freeze, and evaluation;
- fixture cases for diverse model behaviors and all evaluation statuses;
- one fresh `puzzle:offline` build-run-evaluate smoke test without an external model call;
- root formatting, linting, type checking, tests, and `git diff --check`.

Verification proves that the environment behaves as documented. It does not require agents to solve well, use Git, detect the re-key, collaborate effectively, or avoid workarounds.

## Definition of Done

Palimpsest is delivered when:

- one command builds a deterministic three-stream, six-stage puzzle with one hidden shared partial re-key;
- one command runs exactly three persistent concurrent sessions with the explicit team/Git prompt and no prescribed workflow;
- each agent can use local tools, ordinary shared Git, aggregate private checking, and activity waiting;
- only voluntary completion, per-agent cumulative token exhaustion, and the global wall-time cutoff end model work;
- the runner freezes whatever work exists without requiring commits, checkpoints, manifests, or private submissions;
- a reviewer can record and execute the best inferred solver path against the complete ciphertext;
- deterministic scoring and raw observation preserve model outcomes separately from infrastructure failures;
- obvious raw overlap is observational only;
- the active commands and docs contain no Git metering, publication slots, behavioral gates, solver schema, exact replay, or red-team release requirement; and
- a fresh offline fixture and the repository verification suite pass.

## Claim Boundary

The delivered artifact is one compound puzzle with deterministic construction and scoring. It supports observation of how a particular team used private evidence, Git, checking, and prior rules during one attempt.

It does not claim to isolate collaboration value, prove semantic reasoning, certify belief revision, prevent raw communication, reproduce model decisions, exclude source recognition, or provide a hardened public benchmark. Those limitations do not block running the puzzle; they define how its results should be described.
