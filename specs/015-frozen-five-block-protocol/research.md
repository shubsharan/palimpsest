# Research: Frozen Five-Block Protocol

## Decision 1: One strict study manifest

**Decision**: Replace schema version 1 and `runs` with schema version 2 containing the exact registered five-block protocol.

**Rationale**: The study has one frozen design. A generic run matrix would preserve aliases and degrees of freedom that are neither needed nor scientifically desirable.

**Alternatives rejected**: Extending `runs`, accepting both schemas, or creating a general experiment DSL. All add compatibility or orchestration without improving this puzzle.

## Decision 2: Integer cents for monetary authorization

**Decision**: Store `perAttemptMonetaryCeilingCents` and `totalMonetaryCeilingCents` as non-negative integers.

**Rationale**: These fields record operator authorization, not provider-price estimates. Integer cents are exact, readable, and sufficient for the declared ceiling.

**Alternatives rejected**: Floating-point dollars risk ambiguous serialization; live pricing lookup would falsely imply billing control; micros add precision the protocol does not use.

## Decision 3: Bind both prompt templates and baseline snapshots

**Decision**: The design receipt binds prompt templates with a token-budget placeholder and also binds the baseline concrete prompts used for calibration.

**Rationale**: Token budget is the one prompt-visible adjustable value. Template binding proves all non-budget prompt bytes remain frozen; baseline snapshots preserve the original concrete treatment.

**Alternatives rejected**: Binding only concrete prompts would make an allowed validation adjustment appear to be design drift. Omitting prompts would weaken parity evidence.

## Decision 4: Separate scientific design from agent-visible protocol

**Decision**: Study phase, block order, receipt, rubric, resource ceilings, and replacement lineage live in operator artifacts. The attempt protocol digest continues to cover only treatment inputs visible to the agents.

**Rationale**: Design provenance is necessary for researchers but is not part of the puzzle environment. Keeping it out of prompts and protocol snapshots avoids an accidental behavioral treatment.

**Alternatives rejected**: Adding study context to prompts or protocol snapshots would expose information that the study intends to keep operator-only.

## Decision 5: Reserve launches before sessions

**Decision**: Write a durable launch reservation to the phase summary before any adapter/session work, then resolve it only after a strict attempt is durably indexed.

**Rationale**: If the process crashes after contacting a provider but before publishing an attempt, absence cannot safely mean “never started.” A single local reservation prevents implicit retries.

**Alternatives rejected**: Automatic resume based only on attempt directories risks duplicate behavior. A database, lease service, or retry queue is unnecessary for a sequential local runner.

## Decision 6: Narrow replacement eligibility

**Decision**: Only a frozen attempt classified `session-infrastructure-error` is replaceable. Post-publication overlap/evaluation failures and pre-freeze runner failures are not.

**Rationale**: A replacement needs a valid immutable source attempt and a failure clearly outside model behavior. Sessions already produce a frozen terminal infrastructure state. Overlap and evaluation are optional later observations and should be repaired or rerun against the same attempt, not used to repeat behavior.

**Alternatives rejected**: A broad infrastructure enum would invite selective reruns of ambiguous outcomes. Automatic retries are scientifically unsafe.

## Decision 7: Authorized maxima govern ceilings

**Decision**: Charge every launch its full token and monetary authorization against study ceilings while recording actual usage separately.

**Rationale**: Ceilings are predeclared authorization boundaries. Letting low observed usage fund later launches would turn them into mutable estimates.

**Alternatives rejected**: Actual-usage accounting is retrospective and provider-dependent. Price estimation is out of scope.

## Decision 8: Verify preflight before provider setup

**Decision**: For provider-backed cells, verify the current clean receipt-bound preflight before resolving credentials, constructing adapters, or opening sessions.

**Rationale**: Paid or findings-bearing work must be tied to the tested source and sandbox before any provider activity can occur.

**Alternatives rejected**: A phase-level check alone can become stale during a long local run. Advisory CI is not an authorization receipt.

## Decision 9: Exercise the full protocol without providers

**Decision**: Acceptance builds all five blocks and runs all twenty cells with fixture sessions, fake clocks, local Git, and deterministic scoring; it retains one real Docker/offline smoke instead of multiplying expensive sandbox tests.

**Rationale**: Matrix order, receipt timing, prompt parity, durability, and accounting need complete coverage. Provider behavior and repeated Docker startup do not.

**Alternatives rejected**: Sampling conditions misses order/integration errors. Live calls are costly and nondeterministic. Twenty real sandbox runs add time without distinct evidence.

## Decision 10: Seal complete artifact trees

**Decision**: Use one canonical directory-sealing primitive for complete build roots and frozen Git/workspace roots. A seal deterministically covers sorted relative paths, directory entries, file bytes and lengths, executable bits, and symlink targets.

**Rationale**: The builder, checker, runner, and evaluator consume evolving sets of files. Binding a hand-maintained list makes every new consumed artifact another provenance bug. Whole-tree identity turns the publication boundary into the invariant: anything present when the root is sealed must remain identical whenever the root is reused.

**Alternatives rejected**: Enumerating stage, reference, ciphertext, checker, plaintext, repository, and workspace files duplicates consumer knowledge and inevitably drifts. Copying every tree per launch adds storage without improving local integrity. Signatures, immutable object storage, and transparency logs exceed the threat model of a trusted local research operator.
