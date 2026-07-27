# Evidence Protocol Contract

## Authority

JSON Schema Draft 2020-12 files under `packages/contracts/schemas/` are authoritative. This document describes the boundary and does not duplicate wire shapes. Every instance declares an integer `schemaVersion`; unsupported versions fail explicitly.

Milestone 1 defines only:

1. the shared contract envelope;
2. canonical JSON rules;
3. canonical archive rules;
4. the artifact response manifest; and
5. the gate report.

## TypeScript to Python subprocess

The TypeScript runner supplies a canonical production request path and a fresh empty output directory. The Python producer writes large outputs only under that directory and emits canonical NDJSON progress records on stdout. Stderr is diagnostic and never parsed as a contract.

The final progress record contains an artifact response manifest. A successful process exit without one complete terminal record is a failure. A terminal record followed by more data is a failure. A response manifest with a request digest, producer version, input set, output set, size, or digest mismatch is a failure.

## Promotion

The runner validates, in order:

1. supported execution environment and active network-denial adapter;
2. deadline and process exit status;
3. canonical, gap-free, complete NDJSON;
4. response schema and supported schema version;
5. request digest and allowed producer version;
6. exact output set and safe paths;
7. every output byte length and SHA-256 digest;
8. canonical archive bytes and digest; and
9. atomic rename into an absent digest-addressed destination.

No earlier step creates a promoted path. On any failure, the attempt directory is sealed as failed or removed according to policy, an append-only failure record is written, and the promoted namespace is unchanged.

## Retry

A retry reuses the same immutable request bytes and request digest but receives a new attempt ID and a new empty directory. Files from an earlier attempt are never copied, mounted, linked, or treated as cache inputs.

## Gate report states

A predeclared report contains the frozen question, inputs, thresholds, and pass/rework/stop criteria, plus their canonical digest. It contains no result fields.

A completed report preserves that exact pre-run projection and digest, then adds the supported environment, producer versions, raw artifact references by SHA-256, analysis, result, and follow-up. Validation recomputes the pre-run digest; a changed threshold or input cannot silently complete.
