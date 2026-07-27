# Contract: GitAccountingFrameV1

## Scope

One accepted create or fast-forward update in a Git SHA-256 repository. The frame is the cumulative per-agent communication debit and contains every newly peer-visible logical object relative to the frozen slot-start visibility journal.

## Binary grammar

All integers are unsigned big-endian. All lengths count bytes. No alignment or padding is permitted.

| Field               | Encoding                                         |
| ------------------- | ------------------------------------------------ |
| Magic               | Eight ASCII bytes `PLMPGIT1`                     |
| Frame length        | `u64`, complete header and body                  |
| Accounting version  | `u16`, exact value `1`                           |
| Object format       | `u16`, exact value `1` for Git SHA-256           |
| Authenticated agent | `u16`                                            |
| Publication slot    | `u32`                                            |
| Ref operation       | `u8` (`1` create, `2` update)                    |
| Ref name            | `u16` byte length followed by raw accepted bytes |
| Old OID             | 32 bytes; all zero for create                    |
| New OID             | 32 bytes                                         |
| Object count        | `u32`                                            |
| Object records      | Repeated in unsigned raw OID order               |

Each object record is:

| Field          | Encoding                              |
| -------------- | ------------------------------------- |
| OID            | 32 bytes                              |
| Type           | `u8` (`1` commit, `2` tree, `3` blob) |
| Content length | `u64`                                 |
| Content        | Exact raw Git logical object bytes    |

## Validation

- The declared frame length equals the entire byte string; trailing or truncated bytes are rejected.
- Only accounting version 1 and object format 1 are accepted.
- Create requires an all-zero old OID; update requires a nonzero old OID different from the new OID.
- The ref passes the architecture's bounded writable grammar and operation policy.
- Object OIDs are unique and strictly increasing as unsigned bytes.
- Type and content recompute the recorded Git SHA-256 OID.
- The object list exactly equals the new tip's reachable commit/tree/blob closure minus the slot-start ever-visible set.
- Numeric overflow, unsupported type, invalid UTF-8/path/tree content, unsafe mode, ambiguous record, and any unread bytes reject the frame.

## Canonical charge

The communication charge is exactly the frame length. Packfile bytes, delta bases, compression, object order on ingress, filesystem storage, and local object presence are not codec inputs.

## Required vectors

Golden accepted vectors cover create/update, empty and non-empty blob, executable mode, nested tree, linear and merge commits, maximum legal ref, already-visible objects, and same-slot duplicate exposure. Rejected vectors cover every invalid enum, length, ordering, duplicate, hash, reachability, path, mode, old/new transition, overflow, truncation, and trailing-byte case.
