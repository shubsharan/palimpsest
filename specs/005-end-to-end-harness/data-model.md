# Data Model: Offline End-to-End Puzzle Harness

## Instance Bundle

An immutable graph rooted at one `InstanceBuildRequest`.

| Projection | Visibility | Required content |
| --- | --- | --- |
| Public instance | All agents and reports | Puzzle policy, vocabulary direction, scaffold and public artifact references |
| Agent reference corpus | All agents | Exact duplicate-screened reference corpus manifest |
| Private shard | One agent | Contiguous chapter-aligned cipher text and per-agent release membership |
| Reveal schedule | Trusted control; monotone projection per agent | Absolute offsets and complete chapter batches |
| Difficulty and scoring | Trusted; redacted public subset | Switch, matching, threshold, and score policy |
| Sealed oracle | Builder, grader, replay only | Source, prepared plaintext, keys, changed/control sets, target reconstruction |

Every artifact reference includes type, schema version, canonical byte length, SHA-256 digest, and producer version.

## Run Identity

`harness / declaration-digest / run-id`

`attempt.json` is the immutable start receipt. `terminal.json` seals the classification and sorted exact output set. A terminal attempt cannot be reused or appended to. `current.json` is mutable operator state and never evidence.

## Run Manifest

The manifest binds:

- instance bundle and `GitGenesis`;
- three authenticated agent IDs, private shard IDs, container images, fixture policy, scaffold, and host bridge version;
- monotonic reveal, publication, deadline, drain, freeze, and finalization policies;
- compute, disk, memory, invocation, file-read, and subagent limits;
- Git object, ref, rate, capability, accounting, and cumulative budget policies;
- solver, scoring, replay, redaction, environment, and failure-injection policies.

## Lifecycle

`PREPARED -> STARTING -> RUNNING -> PUSH_CLOSED -> DRAINING -> FROZEN -> FINALIZING -> SUBMITTED -> REPLAYED -> SCORED`

`INVALID` is reachable from every trusted state after an integrity or validity failure. Agent mistakes do not transition to `INVALID`.

### State invariants

- `PREPARED` requires complete preflight and no running processes.
- `STARTING` creates private domains, repository genesis, ledgers, event chain, and a common launch barrier.
- `RUNNING` establishes one monotonic epoch before the first release or agent action.
- `PUSH_CLOSED` rejects new receive streams but retains completely received admitted requests.
- `DRAINING` processes only requests assigned an arrival sequence before closure.
- `FROZEN` binds one ref map, Git bundle, visibility journal, ledger set, and event-chain head; Git becomes pull-only.
- `FINALIZING` retains compute limits and permits only frozen pulls plus private output work.
- `SUBMITTED` hashes and closes private mounts and terminates workers.
- `REPLAYED` proves trusted state and clean solver execution from sealed inputs.
- `SCORED` seals score and public report artifacts.

## Run Event

Each event contains:

- run and schema identity;
- unsigned global sequence;
- trusted producer and idempotent effect ID;
- event type and canonical payload;
- monotonic elapsed nanoseconds;
- previous-event digest and own digest.

Duplicate effect IDs are accepted only when canonical bytes match. Gaps, conflicting duplicates, reorderings, or digest mismatches invalidate the run.

## Git Transaction and Ledger

A transaction records the authenticated agent, captured publication snapshot, accepted receive arrival sequence, requested ref changes, quarantine closure, exact `GitAccountingFrameV1` bytes and digest, budget before and after, authoritative ref outcome, rejection code if any, and event sequence.

Reservations transition:

`PENDING -> REF_COMMITTED -> LEDGER_COMMITTED`

Recovery produces exactly one consistent ref/ledger state or invalidates the run. Rejected transactions never debit communication. Identical objects are charged independently to each exposing sender.

## Published Snapshot

An immutable slot record containing:

- slot ordinal and public boundary time;
- complete advertised ref map;
- exact object closure and canonical fetch profile;
- predecessor snapshot;
- visibility-journal digest;
- authoritative event sequence.

Connections capture one snapshot for their lifetime and never observe an intermediate ref map.

## Freeze Snapshot

The final complete ref map, Git bundle reference, visibility journal, per-agent ledgers, final event sequence, event-chain head, final released-shard manifests, and public/private projection digests.

## Fixture Agent Invocation

The host bridge request contains only:

- run, agent, container, policy, and invocation identity;
- currently released private files;
- captured publication snapshot and authenticated Git endpoint;
- remaining compute and deadline policy;
- agent workspace and private output paths.

The response is an ordered NDJSON stream of observable text, tool, file, Git, resource, checkpoint, error, and terminal events. No private reasoning field exists.

## Private Deliverable

One agent-owned sealed artifact set binding:

- agent and run identity;
- freeze ID and final released-shard digest;
- reconstruction, mapping, hypothesis, confidence, and executable solver references;
- exact output set and resource telemetry.

It is never stored in peer-visible Git.

## Solver Execution and Score Report

The solver execution binds the hostile input bundle, filtered staging manifest, container and network policy, process result, exact declared outputs, and byte comparison. The score report binds reconstruction, entity, dictionary, changed/stable, switch, latency, collaboration, and optional confidence rows to one scoring policy and oracle identity.

## Trusted Replay Bundle

The sealed graph of instance, run, Git, event, reveal, ledger, freeze, submission, solver, scoring, and environment artifacts sufficient to recompute every trusted state and report digest.

## Offline Harness Completion Report

The report records:

- frozen declaration and exact attempt identity;
- all required verification and failure-injection evidence;
- repeated-attempt isolation and replay equality;
- public redaction verdict;
- zero external model requests;
- `liveModelValidationAuthorized: true` only when every required predicate passes;
- an explicit statement that fixture behavior is not empirical model evidence.
