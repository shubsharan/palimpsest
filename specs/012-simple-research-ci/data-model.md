# Data Model: Simple Research Verification

## Preflight Receipt

One canonical receipt exists at `artifacts/preflight.json` after a successful preflight. A byte-equivalent decoded receipt is copied to `preflight.json` in every authorized live attempt root before model sessions begin.

| Field                    | Type    | Validation                                                  |
| ------------------------ | ------- | ----------------------------------------------------------- |
| `schemaVersion`          | integer | Exactly `1`                                                 |
| `testedCommit`           | string  | Lowercase 40- or 64-character Git object ID naming a commit |
| `sourceClean`            | boolean | Exactly `true`                                              |
| `completedAt`            | string  | Valid ISO 8601 timestamp                                    |
| `sandbox.imageTag`       | string  | Current declared sandbox tag                                |
| `sandbox.imageId`        | string  | `sha256:` plus 64 lowercase hexadecimal characters          |
| `sandbox.sourceDigest`   | string  | 64 lowercase hexadecimal characters                         |
| `sandbox.profileVersion` | integer | Exactly the current profile version                         |

### Relationships

- `testedCommit` equals the clean checkout revision at both the beginning and end of preflight.
- `sandbox` equals the rebuilt image identity, the fresh fixture's actual sandbox identity, and the image inspected before the live run.
- A live attempt's copied receipt equals the canonical receipt that authorized it.
- The live attempt's existing `attempt.json.sandbox` equals the copied receipt's sandbox identity plus the current sandbox policy.

### Lifecycle

```text
absent -> preflight running (still absent) -> passed receipt
                   |
                   +-> any failure -> absent

passed receipt -> new preflight starts -> absent
passed receipt -> source or sandbox changes -> rejected by live run
passed receipt -> matching live run -> copied into attempt artifacts
```

The implementation supports one local operator and one canonical receipt. Concurrent preflight writers, receipt signing, remote verification, retention policy, and receipt migration are out of scope.

## Advisory Check Result

The advisory check uses the hosting platform's ordinary pass/fail result. It creates no project artifact, grants no experiment authorization, and is not a required branch-protection context.
