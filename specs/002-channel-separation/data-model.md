# Data Model: Channel Separation

## Git Genesis

The immutable common starting state for one sweep.

| Field               | Rule                               |
| ------------------- | ---------------------------------- |
| `schemaVersion`     | Exact supported version            |
| `accountingVersion` | `1`                                |
| `objectFormat`      | Git SHA-256                        |
| `publishedRefs`     | Sorted bounded ref/OID map         |
| `everVisibleOids`   | Sorted unique 32-byte identifiers  |
| `canonicalSha256`   | Digest of the canonical projection |

## Logical Git Object

| Field           | Rule                                          |
| --------------- | --------------------------------------------- |
| `oid`           | 32 raw bytes and lowercase 64-hex rendering   |
| `type`          | Commit, tree, or blob only                    |
| `content`       | Exact raw logical object content              |
| `contentLength` | Unsigned 64-bit length equal to content bytes |

The identifier must match Git's SHA-256 object preimage for the declared type and length. Tree content preserves modes, names, and child identifiers; commit content preserves parents, identities, timestamps, message, and ordering.

## Logical Transaction

| Field                    | Rule                                                 |
| ------------------------ | ---------------------------------------------------- |
| `authenticatedAgent`     | Fixed run-local unsigned 16-bit number               |
| `publicationSlot`        | Unsigned 32-bit slot                                 |
| `operation`              | Create or fast-forward update                        |
| `refName`                | Raw bounded accepted ASCII ref bytes                 |
| `oldOid` / `newOid`      | 32-byte identifiers; create uses zero old identifier |
| `newlyVisibleObjects`    | Unsigned-OID-sorted unique logical objects           |
| `slotStartJournalDigest` | Digest of the visibility set used for accounting     |

Validation reconstructs the reachable closure from `newOid`, subtracts the slot-start ever-visible set, and requires exact equality with `newlyVisibleObjects`.

## Git Accounting Frame V1

The injective binary serialization of one logical transaction. Its byte length is the transaction charge. It has no mutable state transition: bytes decode to one valid value or are rejected.

## Visibility Journal

An append-only sorted set of every OID peer-visible before a publication slot. All candidates in a slot read the same frozen journal; after decisions, accepted candidate closures are unioned to form the next journal.

## Channel Fixture

| Field                           | Rule                                     |
| ------------------------------- | ---------------------------------------- |
| `fixtureId`                     | Stable identifier                        |
| `source`                        | License/provenance artifact reference    |
| `tokenCount` / `vocabularySize` | Exact declared geometry                  |
| `opaqueShard`                   | Digest-addressed exact relay target      |
| `commonInputs`                  | Digest-addressed side-information bundle |
| `normalization`                 | Versioned deterministic procedure        |

## Relay Attempt

| Field                         | Rule                                                |
| ----------------------------- | --------------------------------------------------- |
| `fixture` / `strategy`        | Frozen references                                   |
| `accessedInputs`              | Exact subset of declared common inputs              |
| `transactions`                | Ordered cumulative logical transactions             |
| `frameDigests` / `frameBytes` | Exact per-update evidence and sum                   |
| `separateCapacityBits`        | Timing/presence and residual-channel allowance      |
| `decodedOutput`               | Artifact reference                                  |
| `exactReconstruction`         | True only when output bytes equal the shard         |
| `status`                      | Promoted success, failed attack, or invalid attempt |

## Useful-State Checkpoint

A canonical semantic fixture containing mapping hypotheses, confidence, provenance, contradictions, switch hypotheses, reconstruction diffs, and a version link. An encoding is valid only when decoding reproduces the entire canonical checkpoint.

## Budget Sweep Point

| Field                      | Rule                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `budgetBytes`              | One predeclared cumulative cap                                    |
| `maximumUsefulCharge`      | Greatest valid useful-state cumulative frame sum                  |
| `minimumRelayCharge`       | Least successful exact-relay cumulative frame sum                 |
| `relayCapacityCreditBytes` | Ceiling of separately bounded capacity bits divided by eight      |
| `usefulFits`               | Every required checkpoint is within budget                        |
| `relayBlocked`             | Every successful relay remains above budget after capacity credit |
| `classification`           | Pass only when both booleans are true                             |

## Gate A Report

Uses the Milestone 1 gate-report state machine. The predeclared projection is immutable. Completion adds raw artifact references, metrics, extrema, retained interval, limitations, result, and follow-up.

### State Transitions

```text
draft inputs -> predeclared -> judged attempts -> completed(pass|rework|stop)
                        \-> invalid (integrity failure; no gate result)
```
