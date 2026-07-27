# Research: Behavior-Neutral Multi-Agent Puzzle Runner

## Decision 1: Use persistent independent sessions with a provider adapter

**Decision**: Define a small `AgentAdapter` that accepts one persistent session, tool results, and prior provider state. Supply an OpenAI Responses implementation for live runs and a deterministic scripted implementation for offline verification.

**Rationale**: Persistence preserves each model's private context while an adapter keeps orchestration testable and avoids embedding benchmark semantics in one provider API. A final assistant response has a natural meaning: that session chose to finish.

**Alternatives considered**:

- Fixed rounds were rejected because they synchronize agents and prescribe cadence.
- One-shot subprocess agents were rejected because waiting, staged evidence, and cumulative context become artificial.
- A shared group-chat context was rejected because it violates private evidence and removes Git as the supplied peer channel.

## Decision 2: Separate temporal stages from textual shard boundaries

**Decision**: Build three private streams and deterministically divide each into six useful stage segments. Apply the same hidden mapping transition between stages three and four in every stream.

**Rationale**: The earlier chapter-based geometry placed a global transition inside only one agent's shard. Six temporal segments per stream guarantee all three agents see useful evidence before and after the same transition while preserving private inputs. Pre-transition evidence must support a plausible working rule and post-transition evidence must make stale application meaningfully wrong; otherwise the run cannot reveal whether agents detect invalidated beliefs, review them with peers, and update them.

**Alternatives considered**:

- Giving each agent a copy of every chapter was rejected because the evidence would no longer be meaningfully distributed.
- Agent-specific transition times were rejected because they confound belief revision with differing schedules.
- Rewriting earlier files was rejected because it destroys the evidence needed to review prior beliefs.
- Announcing the re-key or requesting a revised mapping was rejected because it supplies the detection and review step the puzzle is meant to observe.

## Decision 3: Use ordinary local Git with a bare shared remote

**Decision**: Give each agent an ordinary clone of one local bare repository with standard Git commands and no gateway accounting, publication slots, required refs, or content policy.

**Rationale**: A preconfigured repository makes the collaboration channel legible while leaving all Git behavior voluntary. Native Git already supplies branching, history, conflict, and concurrent publication behavior.

**Alternatives considered**:

- A custom patch or message protocol was rejected because it prescribes collaboration artifacts.
- A metered Git gateway was rejected because byte accounting and acceptance policy turn model behavior into harness validity.
- A single shared working tree was rejected because ordinary concurrent writes would create host races unrelated to the puzzle.

## Decision 4: Wake waiting sessions from append-only activity

**Decision**: Represent private stage releases and changes to peer-visible Git heads as activity events. `wait_for_activity` records a cursor and suspends only that session until a later event or the global cutoff.

**Rationale**: This permits efficient asynchronous work without a round barrier. The event says that something changed, not what action the model should take.

**Alternatives considered**:

- Polling every model repeatedly was rejected because reinvocation manufactures model behavior and consumes tokens.
- Waking all agents on every event was rejected because it creates unnecessary synchronization.
- Requiring a fetch after wake was rejected because Git operations remain the model's choice.

## Decision 5: Count cumulative provider usage, not interactions

**Decision**: Sum input and output tokens reported for every model response per session. Stop only the exhausted session when the configured budget is reached; the global monotonic deadline stops all remaining work.

**Rationale**: Token and time budgets bound cost without limiting the number of reasoning/tool cycles. Provider-reported usage is the closest available measure of actual model consumption.

**Alternatives considered**:

- Tool-call and response caps were rejected because they prescribe work style.
- Charging Git bytes or checker calls was rejected because those are behaviors to observe.
- A shared team token pool was rejected because one agent could terminate peers.

## Decision 6: Keep the checker aggregate and deliberately permissive

**Decision**: Compare a candidate against only currently released truth for that agent and return matched words, total words, coverage, and accuracy. Missing and extra words count against the result. Repeated calls are allowed.

**Rationale**: The feedback is useful for self-checking but does not identify corrections or mismatch locations. If agents exploit aggregate feedback through repetition, that is experimental behavior.

**Alternatives considered**:

- Per-position diagnostics were rejected because they leak the solve path.
- Call quotas and adaptive noise were rejected because they guard against behavior the experiment wants to observe.
- Exact-length rejection was rejected because malformed and partial reconstructions should receive informative aggregate results.

## Decision 7: Make reviewer execution explicit and post hoc

**Decision**: Freeze the attempt first, then have a reviewer record a command and output path. Execute that selection against the complete ciphertext and assign one of four operational statuses before scoring available output.

**Rationale**: Teams can write arbitrary code without a required manifest or filename. Recording the selection distinguishes reviewer judgment from model output and makes failures interpretable.

**Alternatives considered**:

- Requiring a solver manifest was rejected because it prescribes an intermediate artifact.
- Automatically guessing one entrypoint was rejected because ambiguous repositories need human judgment.
- Treating broken code as an invalid attempt was rejected because it is a model outcome.

## Decision 8: Observe only obvious raw overlap

**Decision**: After the run, compare normalized committed text with normalized private ciphertext and plaintext using a conservative long-span threshold. Record exact findings only.

**Rationale**: The prompt can request compact code-centric sharing without constructing a covert content policy. A narrow observer supports analysis while minimizing interpretive claims.

**Alternatives considered**:

- Pre-receive blocking and warning were rejected because they shape behavior.
- Semantic similarity classifiers were rejected because their uncertainty invites false claims.
- No observation was rejected because obvious raw relay remains useful context for reviewing Git behavior.

## Decision 9: Retire the hardened harness from the active path

**Decision**: Add the new canonical runner first, verify it, then remove `harness:*` entrypoints and the active hardened runtime/tests while retaining reusable low-level generation code and historical specs.

**Rationale**: Side-by-side implementation reduces migration risk, but leaving two canonical runners would keep the project ambiguous. Git history and numbered specs are sufficient archives of the previous design.

**Alternatives considered**:

- Retrofitting every old harness component was rejected because its types encode gates, promotion, replay, slots, and accounting.
- Deleting all prior gate code immediately was rejected because shared primitives and unrelated historical experiments still use it.
- Keeping both command families indefinitely was rejected because operators could accidentally run the wrong experiment.
