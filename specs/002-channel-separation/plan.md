# Implementation Plan: Channel Separation

| Field  | Value                                            |
| ------ | ------------------------------------------------ |
| Branch | `002-channel-separation`                         |
| Date   | 2026-07-26                                       |
| Spec   | [spec.md](./spec.md)                             |
| Input  | Roadmap Milestone 2, Channel Separation (Gate A) |

## Summary

Implement the exact architecture-defined `GitAccountingFrameV1` as a dependency-free TypeScript binary codec over logical SHA-256 Git transactions, then drive it from real native Git repositories and an adversarial compression harness. The judged Gate A sweep freezes representative opaque-token shard geometries, common side information, useful belief payloads, compressor/codebook strategies, publication-slot capacity, exact supported tools, numeric budgets, and the pass/rework/stop rule before measurement. Every candidate becomes real peer-visible commits, trees, blobs, and refs; pack or compressed payload size is diagnostic only, while the complete serialized accounting frames determine the operative cumulative charge.

## Technical Context

| Concern | Decision |
| --- | --- |
| Language/version | TypeScript 7.0.2 on Node.js 26.5.0 owns the frame codec, native Git reconstruction, and sweep coordinator; Python 3.12.4 owns fixture text normalization, opaque-token shard construction, custom statistical codecs, and analysis |
| Primary dependencies | Existing `@palimpsest/contracts` and Node standard library; native Git 2.48.1; Node `zlib` implementations of Deflate, Brotli, and Zstandard; Python standard-library `zlib`, `bz2`, and `lzma`; no new runtime package unless a predeclared stronger codec cannot be implemented or invoked reproducibly |
| Storage | Temporary SHA-256 Git repositories plus canonical, digest-addressed Milestone 1 artifact bundles under `artifacts/gate-a/` |
| Testing | Vitest unit/property/contract/integration tests; pytest and Hypothesis for token/coding properties; native Git golden vectors and pack-invariance probes; cross-runtime canonical fixture checks |
| Target platform | Pinned Darwin ARM64 development evidence profile and single-host Linux reference profile; evidence is profile-specific and no cross-profile equality is claimed until both are run |
| Project type | Binary codec library, offline research CLI, and evidence producer |
| Performance goals | Encode/decode every allowed maximum frame within predeclared receive limits; complete the frozen local sweep within four hours; record CPU time and peak memory diagnostically without changing the gate decision |
| Constraints | Network-disabled judged attempts; Git SHA-256 only; exact frame grammar; one ref update per transaction; no live gateway, agents, secrets, generator, grader, or full harness |
| Scale/scope | Three shard lengths (16,384; 27,000; 40,960 tokens), three vocabulary geometries (4,096; 8,000; 12,288 types), a frozen useful-state workload, at least eight relay families, 120 publication slots, and cumulative budgets from 4–64 KiB in 1 KiB increments |
| Owning gate/milestone | Roadmap Milestone 2, Gate A; pass freezes an accounting version and defensible interval, rework changes information geometry, stop forbids manufactured separation |
| Trust boundaries | Fixture acquisition is a trusted pre-run step; judged codec, Git, compressor, and analysis attempts receive only digest-bound common inputs in fresh network-disabled workspaces; no output is agent-visible |
| Contracts/artifacts | Versioned `GitAccountingFrameV1`, `GitGenesis`, logical transaction, relay/useful attempt, timing-capacity, sweep-result, and Gate A report schemas; golden frame binaries; canonical archives; Milestone 1 manifests and promotion |
| Replay claim | Frozen inputs and exact tool/profile versions reproduce frame bytes, Git logical closures, promoted attack outputs, sweep classifications, and report analysis; no claim covers all possible compressors, later agent behavior, OS scheduling, or another Git version |

## Constitution Check

- **Evidence before scale - PASS**: Scope stops at the exact meter and adversarial capacity evidence required by Gate A. The numeric geometry, attack matrix, slot capacity, sweep, and decision rule are frozen before the judged run.
- **Trust boundaries - PASS**: No agent, secret, oracle, live remote, credential, generator, grader, or network service is introduced. Judged subprocesses reuse the network-disabled Milestone 1 promotion boundary.
- **Contracts and provenance - PASS**: New Gate A boundaries are versioned schemas or an exact binary grammar with golden vectors. All raw results are canonical, manifest-bound, and digest-addressed.
- **Verification and claims - PASS**: The plan names codec properties, real-Git equivalence probes, cross-runtime fixtures, attack reconstruction, cumulative accounting, evidence replay, and the empirical limits of "strongest tested".
- **Native bounded collaboration - PASS**: The harness uses ordinary Git objects and refs and exactly simulates the architecture's slot-start journal and fixed-slot capacity without inventing turns, roles, abstract message sizes, or a replacement collaboration API.

### Post-design Recheck

The design preserves all five principles. Separating the binary codec, native Git oracle, fixture/codecs, and evidence analysis makes independently testable boundaries without pre-building the live gateway. The only calibrated values are in the predeclaration inputs; changing them invalidates the judged report.

## Project Structure

### Documentation

```text
specs/002-channel-separation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── git-accounting-frame-v1.md
│   └── gate-a-evidence.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code

```text
packages/
├── contracts/
│   ├── schemas/                       # Gate A JSON contract additions
│   ├── fixtures/                      # Cross-runtime accepted/rejected cases
│   └── src/
└── git-accounting/
    ├── src/
    │   ├── codec.ts                   # exact frame encoder/decoder
    │   ├── git-objects.ts             # logical commit/tree/blob parsing
    │   ├── transaction.ts             # newly-visible closure and validation
    │   ├── visibility.ts              # slot-start journal semantics
    │   └── index.ts
    ├── fixtures/                      # golden frame binaries and Git vectors
    └── tests/
        ├── codec.test.ts
        ├── mutation.test.ts
        └── transaction.test.ts
python/
├── src/palimpsest/channel/
│   ├── fixtures.py                    # frozen opaque-token shard builder
│   ├── codecs.py                      # token, dictionary, and codebook attacks
│   └── analysis.py                    # exact reconstruction and frontier analysis
└── tests/
    ├── test_channel_fixtures.py
    ├── test_channel_codecs.py
    └── test_gate_a_analysis.py
tools/gate-a/
├── native-git.ts                      # repository and pack-variation driver
├── relay-runner.ts                    # real-Git attack materialization
├── useful-state.ts                    # faithful useful workload materialization
├── timing-capacity.ts                 # slot/presence upper bound
├── sweep.ts                           # cumulative budget classification
└── report.ts                          # predeclare/complete/replay
tests/gate-a/
├── pack-invariance.test.ts
├── same-slot-visibility.test.ts
├── channel-surface.test.ts
└── evidence-replay.test.ts
artifacts/gate-a/
├── inputs/
├── predeclaration.json
├── raw/
├── by-digest/
├── gate-report.json
└── milestone-report.json
```

**Structure Decision**: Add one TypeScript package for the production accounting contract, extend the existing cross-runtime schema package only for JSON evidence envelopes, and keep adversarial research codecs in the Python research plane. Gate-only orchestration remains under `tools/gate-a/`; it does not create a premature live gateway or application package.

## Complexity Tracking

No constitution violation requires an exception.
