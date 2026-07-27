# Research: Channel Separation

## Decision 1: Native Git is the logical-state oracle

**Decision**: Use pinned native Git 2.48.1 with SHA-256 repositories to create objects, refs, reachability closures, and deliberately varied pack encodings. The accounting codec reads exact loose logical object content through batch plumbing commands and never parses pack bytes to determine charge.

**Rationale**: Gate A must measure real refs, commits, trees, and blobs, while the architecture explicitly makes pack compression irrelevant. Git documents packfiles as transport/storage representations whose object order, delta window, delta depth, base selection, and reuse can vary. Native plumbing avoids an independently reimplemented Git object model and lets the same transaction be repacked many ways as an invariance probe.

**Alternatives considered**: A JavaScript Git implementation risks incomplete SHA-256 and pack behavior; libgit bindings add a second native compatibility surface; abstract object fixtures cannot establish the roadmap's real-Git requirement.

## Decision 2: The production frame codec has no Git or compression dependency

**Decision**: Implement the exact fixed-width big-endian binary grammar with Node buffers in `@palimpsest/git-accounting`. The codec accepts a validated logical transaction, sorts object identifiers as unsigned bytes, recomputes the complete length, rejects ambiguity and trailing bytes, and exposes no pack-size input.

**Rationale**: A small dependency-free codec is auditable, portable to the later gateway, and easy to exercise with golden vectors and mutation tests. Keeping Git reconstruction outside the codec prevents transport representation from leaking into charge.

**Alternatives considered**: Protobuf, CBOR, MessagePack, and JSON add encoding choices not present in the architecture and would require a new accounting version.

## Decision 3: Freeze a sensitivity matrix rather than a single favorable shard

**Decision**: The pre-run matrix crosses token lengths 16,384, 27,000, and 40,960 with vocabulary geometries 4,096, 8,000, and 12,288. Each fixture preserves punctuation/paragraph structure while replacing word types with opaque ordered identifiers. The judged bundle records source-license provenance, normalization, token inventory, fixture digest, and whether the source is common or withheld from the reference corpus.

**Rationale**: The proposal predicts that separation varies with token length and vocabulary geometry. A matrix exposes that dependency and prevents selecting one favorable point after measurement. Opaque ordered identifiers approximate the shard relay problem without pre-building the production puzzle generator or claiming Gate B evidence.

**Alternatives considered**: One 27,000-token synthetic shard is too easy to overfit; full production instances violate gate ordering; raw plaintext understates the token-ID attack granted by shared vocabulary order.

## Decision 4: Use an explicit strongest-tested codec ladder

**Decision**: Freeze raw UTF-8, fixed-width token IDs, varint token IDs, canonical Huffman token IDs, Deflate level 9, reference-dictionary Deflate, bzip2 level 9, LZMA/XZ preset 9, Brotli text quality 11, Zstandard level 22, reference-conditioned delta plus compressor, sparse and complete dictionary/codebook payloads, and cumulative split histories. Every codec has a paired exact decoder and input-access manifest.

**Rationale**: Node 26.5.0 exposes Deflate, Brotli, and Zstandard, including dictionary-capable Deflate; Python 3.12.4 provides zlib, bzip2, and LZMA. Combining general compressors with token-aware and reference-conditioned codecs tests the main attack families using pinned local implementations. A reconstruction digest, not compressed size alone, determines success.

**Alternatives considered**: Shelling out to whatever compressor is installed makes replay profile-dependent; only gzip or raw token IDs is not a credible strongest-attacker test; learned compressors or frontier models introduce weight/model provenance and stochasticity better handled as a later red-team extension unless predeclared.

## Decision 5: Useful state is a faithful fixed workload, not arbitrary prose

**Decision**: Freeze canonical useful-state checkpoints containing 512 mapping hypotheses with confidence and provenance, 64 contradiction observations, 8 localized switch hypotheses, and 16 reconstruction-diff summaries across four cumulative versions. Both verbose canonical JSON and optimized binary/token representations may compete, but decoded content must equal the same semantic fixture.

**Rationale**: The lower edge of a budget interval must carry an auditable evolving belief state rather than a hand-picked short message. Fixed semantic equality prevents an encoder from appearing cheap by dropping confidence, provenance, contradictions, or history. Gate D will later test whether agents actually benefit from this amount of state.

**Alternatives considered**: A full dictionary unnecessarily approaches relay capacity; a few notes are not plausibly sufficient; using future agent traces would invert the gate dependency.

## Decision 6: Bound timing capacity conservatively and separately

**Decision**: Model a 60-minute run with 30-second slots, at most one accepted push per agent per slot, yielding 120 binary push-presence choices. Add the conservative 120-bit (15-byte) capacity to the attacker's relay capacity before classifying any byte-ledger interval. Raw ref-name and object choices remain inside frames; any measured fetch-pack residual channel is added separately.

**Rationale**: The architecture states that the byte ledger is not a complete information-theoretic bound. A clear worst-case slot-presence allowance prevents a nominal byte interval from ignoring free timing bits without pretending fixed slots eliminate timing.

**Alternatives considered**: Ignoring timing overstates separation; charging time as frame bytes changes the architecture; a stochastic traffic model provides a weaker bound than the adversarial binary-choice calculation.

## Decision 7: Predeclare a broad byte sweep and an algebraic pass rule

**Decision**: Evaluate cumulative per-agent budgets from 4 KiB through 64 KiB inclusive in 1 KiB increments. A point passes only when all useful-state checkpoints fit and every exact complete-shard relay remains over budget after timing/residual capacity credit. The Gate A result passes if at least one contiguous interval of three or more sweep points meets the rule for the retained geometry and sensitivity results do not expose an unaccounted channel.

**Rationale**: The range brackets the proposal's nominal useful-state and compressed-shard sizes while avoiding a single post hoc cap. Requiring three adjacent points prevents a one-step boundary artifact from being called practical.

**Alternatives considered**: Choosing the cap after observing extrema violates the constitution; an analytical entropy estimate cannot replace exact real-Git measurements; a single passing point is too brittle for later calibration.

## Decision 8: Reuse Milestone 1 evidence and promotion

**Decision**: Gate A predeclaration and attempts use the existing canonical JSON/archive, artifact response manifest, network isolation, failed-attempt recording, digest store, and completed gate-report flow. Gate A extends the shared schema registry with its first domain contracts and preserves version 1 of every Milestone 1 contract.

**Rationale**: Milestone 1 exists to make this evidence citable. Reusing it avoids a second artifact protocol and makes changes to its load-bearing contracts explicitly invalidating.

**Alternatives considered**: Ad hoc CSV/plots without manifests are not reproducible evidence; rewriting the promotion runner inside the harness duplicates trusted failure semantics.

## Primary references

- Git `pack-objects` documentation: pack order, compression, delta windows, and depths vary independently of logical objects.
- Node.js 26.5.0 `node:zlib` documentation: pinned Deflate, Brotli, Zstandard, quality, and dictionary capabilities.
- Python standard-library documentation: pinned zlib, bzip2, and LZMA codec behavior.
- `docs/proposal.md`, `docs/architecture.md`, and `docs/roadmap.md`: authoritative channel question, frame grammar, side-information standard, and gate order.
