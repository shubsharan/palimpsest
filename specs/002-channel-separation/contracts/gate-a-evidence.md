# Contract: Gate A Evidence

## JSON contracts

Gate A adds versioned strict schemas for:

- `git-genesis`
- `logical-git-transaction`
- `channel-fixture`
- `relay-attempt-result`
- `useful-state-checkpoint`
- `timing-capacity-result`
- `budget-sweep-result`

All contracts use the Milestone 1 envelope, canonical JSON subset, SHA-256 artifact references, unknown-field rejection, and exact supported schema version. Large counts and bit capacities that may exceed the shared safe numeric range are canonical decimal strings.

## Predeclaration

The Gate A predeclaration freezes:

- all contract/schema and golden-vector artifacts;
- exact implementation and test source bundles;
- Git genesis, object format, policy, and supported Git profile;
- source/license, normalization, opaque shard, useful-state, and common-input artifacts;
- compressor and codebook strategy versions and parameters;
- token/vocabulary geometry matrix;
- 60-minute run, 30-second slots, one accepted push per agent per slot, and conservative 120-bit presence capacity;
- 4–64 KiB cumulative budget points in 1 KiB increments;
- environment and producer versions;
- the algebraic point classifier and three-adjacent-point pass rule;
- pass, rework, stop, invalidation, and downstream authorization text.

## Completion

The completed report adds digest references for native Git fixtures, accounting vectors, pack-invariance results, relay attempts, useful-state attempts, timing/residual capacity, sweep table, plots, and analysis. Metrics include fixture disagreements, codec/vector failures, unmeasured mutations, pack-invariance disagreements, exact relay successes/failures, best relay charge by geometry, worst useful charge, separate capacity, interval endpoints, adjacent passing points, environment mismatches, and unresolved artifacts.

## Point classification

For budget `B`, useful maximum `U`, minimum exact-relay charge `R`, and conservative separately bounded attacker capacity `C` bytes:

```text
usefulFits  := U <= B
relayBlocked := R - C > B
pointPasses := usefulFits and relayBlocked
```

Gate A passes only if the predeclared retained geometry has at least three adjacent passing sweep points and no integrity check or unaccounted channel fails. Absence of such an interval is `rework` unless the roadmap's permitted geometry changes have been exhausted, in which case the maintainer may record `stop`. Integrity failures produce no gate result.
