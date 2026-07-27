# Research: Foundation and Evidence Protocol

## Decision 1: Exact supported toolchain

**Decision**: Pin Node.js 26.5.0, TypeScript 7.0.2, pnpm 10.14.0, Python 3.12.4, uv 0.11.14, and Git 2.48.1. Record the pins in `package.json`, `.node-version`, `.python-version`, and `.tool-versions`, and make the root verification command reject any different evidence-producing version.

**Rationale**: These exact versions are available in the implementation environment, satisfy the architecture's two-runtime boundary, and make evidence claims narrow and testable. pnpm and uv retain independent lockfiles and synchronize exact dependency graphs.

**Alternatives considered**: Broad semver ranges were rejected because they make clean-checkout evidence drift. Containers were deferred because Milestone 1 owns the workspace and evidence protocol, while production images belong to later milestones.

## Decision 2: JSON Schema authority and validation

**Decision**: Use JSON Schema Draft 2020-12 files in `packages/contracts/schemas/` as the sole authority. Ajv and Python jsonschema load those same files, require `schemaVersion`, reject undeclared fields with `unevaluatedProperties: false` or `additionalProperties: false`, and normalize validation failures into a small shared reason vocabulary.

**Rationale**: The architecture explicitly chooses JSON Schema as the language-neutral authority. Draft 2020-12 supports reusable definitions and strict composition. Runtime values are validated against schemas rather than duplicated as independently authored models.

**Alternatives considered**: TypeScript-first schemas and Python-first models were rejected because either runtime would become the hidden authority. Independently maintained interfaces or dataclasses were rejected because drift would be possible even when both compiled.

**Primary reference**: [JSON Schema specification](https://json-schema.org/specification)

## Decision 3: Canonical JSON

**Decision**: Serialize accepted values with RFC 8785 JSON Canonicalization Scheme bytes. Use `canonicalize` in TypeScript and `rfc8785` in Python, reject duplicate object names, lone surrogate code points, non-finite numbers, and negative zero before canonicalization, and encode seeds and non-interoperable integers as schema-constrained decimal or hexadecimal strings.

**Rationale**: RFC 8785 is the architecture's declared format and provides deterministic property ordering and ECMAScript-compatible primitive serialization. The I-JSON restrictions directly address cross-runtime number and string ambiguity.

**Alternatives considered**: Sorted `JSON.stringify` and `json.dumps(sort_keys=True)` were rejected because their number and escaping behavior are not a cross-runtime contract. Normalizing Unicode was rejected because RFC 8785 preserves strings as provided; schemas and path rules handle normalization only where the contract explicitly requires it.

**Primary reference**: [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)

## Decision 4: Canonical archive

**Decision**: Implement the architecture's uncompressed POSIX ustar profile directly in both runtimes. Entries are sorted by normalized UTF-8 path bytes, have zero UID, GID, and mtime, empty owner and group names, normalized file and directory modes, fixed header encoding, and two zero end blocks. Reject absolute paths, dot segments, backslashes, non-NFC paths, case-fold or normalized collisions, non-regular filesystem entries, and paths that cannot fit the selected ustar name field.

**Rationale**: Direct construction makes every byte rule explicit and testable without depending on library defaults for PAX headers, timestamps, owner metadata, padding, or path splitting. Shared golden archives detect any divergence.

**Alternatives considered**: ZIP was rejected because the architecture specifies ustar and ZIP carries more incidental metadata. Runtime tar libraries were rejected for writing canonical bytes because defaults differ; they remain suitable as independent readers in tests.

**Primary reference**: [GNU tar archive format documentation](https://www.gnu.org/software/tar/manual/html_chapter/Formats.html)

## Decision 5: Generic subprocess and atomic promotion

**Decision**: A TypeScript runner creates a fresh attempt directory, freezes a canonical request, launches a versioned Python command with a hard deadline and network-disabled wrapper, parses canonical NDJSON with an explicit terminal record, verifies the response manifest and exact file set, then atomically renames a fully verified staging directory into a digest-addressed artifact location. Every failed attempt receives an append-only canonical record and never writes into the promoted namespace.

**Rationale**: This is the coarse-grained boundary and failure behavior declared by the architecture. Fresh directories prevent scavenging, atomic rename prevents partial visibility, and exact manifests prevent success-shaped omissions or extras.

**Alternatives considered**: In-process Python embedding was rejected by the architecture. Copying files individually into a final directory was rejected because observers could see partial state. Resuming a failed directory was rejected because it breaks immutable retry evidence.

## Decision 6: Network-disabled execution

**Decision**: The runner requires an explicit platform isolation adapter for evidence-producing attempts. The initial adapters use `sandbox-exec` with network denial on supported macOS development hosts and a configurable Linux command compatible with the single-host deployment. Verification refuses evidence mode when no supported adapter is available. Unit tests use a fake adapter only for runner state-machine tests and do not label those attempts as evidence.

**Rationale**: An environment variable or cooperative socket patch is not a trust boundary. Refusing to produce evidence is safer than silently running with network access.

**Alternatives considered**: Monkey-patching Python sockets and relying on convention were rejected because subprocesses or native libraries could bypass them. Building production containers now was rejected because images and the full host isolation profile belong to later milestones.

## Decision 7: Verification and evidence capture

**Decision**: `pnpm verify` runs exact-version checks, Oxfmt, Oxlint, TypeScript build/tests, uv's frozen Python checks/tests, cross-language fixture comparison, deterministic archive comparison, subprocess failure-mode tests, and Milestone 1 evidence report validation. The evidence command writes canonical verdict lists and digests under `artifacts/milestone-1/`; generated artifacts are reproducible but not hand-edited.

**Rationale**: One root command is the architecture's operator-facing verification surface. The independent lockfiles remain intact because pnpm invokes uv as a subprocess rather than resolving Python packages.

**Alternatives considered**: A shell-only verification script was rejected because typed orchestration and structured failure reporting are useful at the cross-runtime boundary. Merging Python tools into npm was rejected because it violates dependency independence.

**Primary references**: [pnpm workspaces](https://pnpm.io/workspaces), [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)
