# Implementation Plan: Foundation and Evidence Protocol

| Field  | Value                                                                       |
| ------ | --------------------------------------------------------------------------- |
| Branch | `001-foundation-evidence-protocol`                                          |
| Date   | 2026-07-26                                                                  |
| Spec   | [spec.md](spec.md)                                                          |
| Input  | Feature specification from `specs/001-foundation-evidence-protocol/spec.md` |

## Summary

Implement Roadmap Milestone 1 as a pinned pnpm and uv workspace with JSON Schema Draft 2020-12 as the sole cross-runtime contract authority. TypeScript and Python validate the same schemas and fixtures, serialize accepted payloads with RFC 8785, construct byte-identical canonical POSIX ustar archives, and expose a generic TypeScript-to-Python subprocess boundary that promotes complete artifacts atomically or records an explicit failed attempt. A single root `pnpm verify` command checks versions, formatting, linting, types, both runtime suites, cross-language agreement, and deterministic promotion.

## Technical Context

| Concern | Decision |
| --- | --- |
| Language/version | Node.js 26.5.0 with TypeScript 7.0.2; Python 3.12.4; pnpm 10.14.0; uv 0.11.14; Git 2.48.1 |
| Primary dependencies | Ajv 8.20.0, canonicalize 3.0.0, @humanwhocodes/momoa 3.3.10; jsonschema 4.26.0, rfc8785 0.1.4 |
| Storage | Immutable content-addressed artifacts and append-only attempt records on the local filesystem; no database |
| Testing | Vitest 4.1.10 for TypeScript, pytest 9.1.1 and Hypothesis 6.161.5 for Python, shared golden fixtures for cross-language checks |
| Target platform | Single-host Linux reference environment with macOS development support; all evidence-producing runtime and tool versions are exact pins |
| Project type | Cross-runtime library and local CLI/tooling workspace |
| Performance goals | No calibrated performance claim in Milestone 1; canonicalization and promotion stream file content and remain bounded by predeclared contract limits |
| Constraints | Offline after dependency synchronization; deterministic bytes; exact declared output set; atomic promotion; no corpus, cipher, baseline, grading, agent, Git-meter, or run-control implementation |
| Scale/scope | Five Milestone 1 contracts, a bounded fixture corpus, one domain-free reference producer, and one local artifact store |
| Owning gate/milestone | Roadmap Milestone 1, "Foundation and evidence protocol"; exit decision is proceed to feasibility work when the boundary and protocol are reproducible |
| Trust boundaries | The TypeScript runner is trusted control-side code; the Python reference producer is trusted research-side code launched with network disabled; neither is agent-facing and neither receives oracle, corpus, shard, credential, or private-output data |
| Contracts/artifacts | Versioned JSON Schemas, RFC 8785 canonical JSON, canonical POSIX ustar bytes, SHA-256 digests, artifact response manifests, failed attempt records, and pre-run/completed gate reports |
| Replay claim | Sealed requests and the exact pinned supported environment reproduce validation verdicts, canonical bytes, archive bytes, promoted artifact bytes, manifests, and digests; this milestone makes no claim about future model behavior, scheduling, agent reasoning, or empirical gate outcomes |

## Constitution Check

_GATE: Passed before Phase 0 research and rechecked after Phase 1 design._

- **Evidence before scale - PASS**: The plan implements only Milestone 1 deliverables and its binary evidence criteria. Gate A-D domain contracts and all full-harness components remain out of scope.
- **Trust boundaries - PASS**: Trusted TypeScript and Python responsibilities communicate only through versioned files and NDJSON. The producer is domain-free, network-disabled, and never packaged for an agent-facing environment.
- **Contracts and provenance - PASS**: Draft 2020-12 schemas, `schemaVersion`, strict unknown-field behavior, shared fixtures, canonical bytes, exact manifests, immutable requests, and fresh-attempt promotion are explicit.
- **Verification and claims - PASS**: TypeScript, Python, cross-language, canonical archive, subprocess failure-mode, retry, and clean-checkout verification are required. Reports distinguish implementation evidence from future empirical results.
- **Native bounded collaboration - PASS, unaffected**: Milestone 1 does not implement or emulate Git collaboration, accounting, publication slots, agents, or matched arms. Their architecture remains unchanged for the milestones that own them.

### Post-design Recheck

The design artifacts retain exactly five contracts, keep all runtime bindings schema-validated rather than independently authored, use one filesystem promotion state machine, and do not add an agent-facing package or a domain producer. No constitution exception or complexity waiver is required.

## Project Structure

### Documentation (this feature)

```text
specs/001-foundation-evidence-protocol/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── evidence-protocol.md
│   └── validation-reasons.md
└── tasks.md
```

### Source Code (repository root)

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
tsconfig.json
.node-version
.python-version
.tool-versions
packages/
└── contracts/
    ├── package.json
    ├── schemas/
    │   ├── contract-envelope.schema.json
    │   ├── canonical-json.schema.json
    │   ├── canonical-archive.schema.json
    │   ├── artifact-response-manifest.schema.json
    │   └── gate-report.schema.json
    ├── fixtures/
    │   ├── manifest.json
    │   ├── valid/
    │   └── invalid/
    ├── src/
    │   ├── archive.ts
    │   ├── canonical-json.ts
    │   ├── digest.ts
    │   ├── index.ts
    │   ├── schema-registry.ts
    │   └── validation.ts
    └── tests/
python/
├── pyproject.toml
├── uv.lock
├── src/palimpsest/
│   ├── contracts/
│   │   ├── archive.py
│   │   ├── canonical_json.py
│   │   ├── digest.py
│   │   ├── schemas.py
│   │   └── validation.py
│   └── evidence/
│       └── reference_producer.py
└── tests/
tools/
├── artifact-runner/
│   ├── cli.ts
│   ├── promotion.ts
│   ├── subprocess.ts
│   └── types.ts
├── evidence/
│   ├── compare-runtimes.ts
│   ├── milestone-report.ts
│   └── verify-versions.ts
└── formatting/
tests/
├── contract/
├── integration/
└── fixtures/
artifacts/
└── milestone-1/
```

**Structure Decision**: Preserve the architecture's pnpm `packages/` and uv `python/` boundaries while adding only the contracts package and root evidence tooling needed by Milestone 1. Generic subprocess and promotion code lives under `tools/`, not in an agent package or a future control-plane package. The Python project exposes only contract support and a domain-free reference producer; future corpus, generation, baseline, grading, replay, agent, infrastructure, and application directories are not scaffolded early.

## Complexity Tracking

No constitution violations require justification.
