# Gate C Evidence Contract

## Evidence Bundle

One completed Gate C bundle contains:

1. The frozen predeclaration and its canonical SHA-256 digest.
2. The private revision-instance manifest and solver-visible projection.
3. The reveal plan and its solver-visible projection.
4. One immutable start receipt plus a terminal manifest binding declaration digest, run ID, environment, model, container, response chain, classification, and exact output set.
5. The append-only reveal event stream and public live event stream.
6. Every raw Responses API event, response object, uploaded-file receipt, solver checkpoint, and solver-created output retained before container expiry.
7. The private oracle changed set, matched controls, score trajectory, integrity report, and Gate C decision.

Every reference records artifact type, byte length, and SHA-256 digest over canonical bytes. A manifest enumerates exact outputs; directory scans and “latest file” selection are prohibited.

## Identity and Promotion

An attempt identity is:

`gate-c / declaration-digest / run-id`

The runner creates a new directory and immutable `attempt.json` start receipt before the first external call. It refuses an existing run ID and never appends to an attempt after `terminal.json` exists. A successful solver run remains nonterminal until deterministic scoring writes the trajectory, decision, and replay manifest. Scoring then atomically writes `terminal.json`, which enumerates and hashes every attempt output other than itself; the completed gate report separately promotes and hashes the terminal manifest. Failed runner attempts are sealed the same way without a solver result. All imports require the explicit declaration digest and run ID. `current.json` may point operators to an attempt but is mutable and cannot satisfy an evidence reference.

## Cross-runtime Schemas

The following version 1 schemas are authoritative:

- `revision-instance`
- `reveal-plan`
- `reveal-event`
- `solver-checkpoint`
- `revision-trajectory`
- `gate-c-decision`

TypeScript and Python must accept and reject the same golden fixtures. Contract changes require a version change or an explicit migration.

## Reveal Validity

A reveal event is valid only when:

- its ordinal is exactly one greater than the preceding event;
- all listed chapter files are complete and hash-valid;
- its durable event timestamp precedes the associated solver request;
- observed monotonic time is not earlier than planned time, subject only to the declared early-release tolerance of zero;
- lateness remains within the declared retryable tolerance of 1,000 milliseconds;
- no future chapter reference or private threshold field reaches the solver projection.

A late reveal within tolerance is recorded as a trusted deviation. A late reveal beyond tolerance, an early reveal, a partial reveal, an out-of-order reveal, or a clock reset invalidates the attempt.

## Scoring Rules

At each checkpoint, score the solver's active cipher-to-plain mappings against the regime appropriate to each revealed occurrence.

- `changedAccuracy`: correct active changed mappings divided by all declared changed mappings.
- `stableAccuracy`: correct active matched controls divided by all declared matched controls.
- `preSwitchGainPp`: best pre-threshold changed-and-control aggregate accuracy minus first-checkpoint accuracy.
- `localizedDropPp`: post-threshold stale changed-mapping loss minus matched stable-control loss.
- `changedRecoveryPp`: best post-detection changed accuracy minus post-threshold changed-accuracy minimum.
- `stableRetentionPp`: final stable accuracy minus best pre-threshold stable accuracy.
- `falseRetractionRate`: previously correct stable controls explicitly retracted or incorrectly superseded divided by previously correct stable controls.

The first correct switch hypothesis must identify the chapter-boundary interval containing the oracle switch. Detection latency starts at the durable reveal event that first reaches 25% of post-switch changed-entry occurrence mass.

## Decision Rule

Return `pass` only when all of the following hold:

- pre-threshold mapping accuracy gains at least 10 percentage points;
- localized changed-entry deterioration is at least 10 percentage points greater than matched-control deterioration;
- changed-entry accuracy recovers at least 10 percentage points after correct detection;
- final stable accuracy is within 5 percentage points of its best pre-threshold value;
- false retractions are at most 10%;
- the first credited switch hypothesis is after the contradiction threshold and before 75% of the post-threshold reveal interval elapses;
- no integrity failure remains.

Return `rework` only when the signal is visible and exactly one predeclared dial owns the failed predicate. A rework result names that dial, invalidates the attempt for gate passage, and requires a new declaration.

Return `stop` when there is no observable localized deterioration, the solver generally collapses or restarts, or no declared dial can plausibly calibrate the failure without changing the premise.

An integrity failure returns `invalid`, not pass, rework, or stop.

## Public Claim

A passing bundle supports only this statement:

> In one retained unrecognized-literary profile, one capable solver showed measurable selective adaptation to one hidden partial re-key under the declared clock-driven reveal.

It does not establish population reliability, non-literary generalization, human comparison, construct validity, communication value, or publication-grade replication.
