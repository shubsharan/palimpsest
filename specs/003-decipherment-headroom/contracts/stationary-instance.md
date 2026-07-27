# Contract: Stationary Instance V1

## Contract Family

Gate B adds strict version 1 JSON Schemas for:

- `gate-b-source-record`
- `gate-b-build-request`
- `gate-b-prepared-plaintext-manifest`
- `gate-b-entity-regeneration-map`
- `gate-b-public-instance-manifest`
- `gate-b-solver-input-manifest`
- `gate-b-oracle-manifest`
- `gate-b-reference-corpus-manifest`

All schemas reject unknown fields and unsupported versions. Cross-runtime values use the existing canonical JSON subset, artifact-reference shape, safe-integer rules, UTF-8/NFC policy, SHA-256 rendering, and exact uncompressed archive profile.

## Build Request

The sealed request binds:

- source artifact and source-record digest;
- exact retained chapter IDs, span-selection policy, and 20,000-token target;
- strip, normalization, tokenization, entity proposal/review, lexicon, derangement, cipher, rendering, and projection versions;
- master seed as a lowercase fixed-width hexadecimal string;
- whole-vocabulary stationary substitution with only the one-letter/multi-letter partition required to keep capitalization rendering invertible;
- exact public, solver-private, trusted-private, and oracle declared output sets;
- producer and supported environment versions.

No implementation default may affect output unless its value appears in the request or a digest-bound versioned profile.

## Invariants

- Source decoding, stripping, span selection, tokenization, entity regeneration, vocabulary construction, keying, ciphering, rendering, and output packaging are deterministic for the frozen request and supported environment.
- The selected plaintext contains exactly 20,000 word tokens.
- The token/non-token spans cover the prepared plaintext exactly with no overlap or gap.
- The key is a complete bijection over the prepared vocabulary and has no identity mapping.
- `recoveredMapping` is the exact inverse of `encryptionKey`.
- Oracle inversion of the cipher view reconstructs the prepared plaintext byte for byte.
- Cipher rendering preserves capitalization patterns, punctuation, digits, paragraphs, and chapter boundaries.
- Every repeated reviewed entity role uses one collision-free regenerated identity according to the review patch.
- Every artifact appears in exactly its declared visibility projection.

## Public Projection

The public manifest is constructed from an explicit schema allowlist and may contain:

- safe instance and profile identifiers;
- cipher-view artifact reference;
- word-token count and vocabulary size;
- tokenization, cipher, rendering, public scoring, and instruction policy versions;
- allowed tool/model identifiers and target-excluded reference-corpus reference;
- public resource limits.

It must not contain or permit derivation from:

- title, author, catalog ID, source URL, source tier, or raw source bytes;
- raw, stripped, or prepared plaintext hashes or byte lengths;
- master seed or derived seeds;
- original entity strings, entity map, review patch, or source offsets;
- vocabulary-to-key alignment, either key direction, or oracle digest;
- non-public candidate/reference exclusion metadata.

## Required Verification

Golden fixtures cover each projection and source tier. Property tests cover repeated builds, seed domain separation, NFC/Unicode/apostrophe tokenization, exact span coverage, bijection, derangement, inverse mapping, rendering, entity consistency, collision rejection, chapter selection, and public leakage. Mutation fixtures reject unknown fields, wrong versions, unsafe paths, invalid hashes, key omissions/duplicates/fixed points, span gaps/overlaps, inconsistent counts, undeclared outputs, and cross-visibility references.
