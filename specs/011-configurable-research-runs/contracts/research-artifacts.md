# Contract: Research Artifacts

## Puzzle build

`puzzle-build.json` schema version 2 is the authoritative resolved scientific record. It includes source/reference identities and digests, chapter range, seed-derived build identity, dynamic agent/stage geometry, ordered re-key transitions, per-stage key version, artifact paths, counts, and hashes.

It does not include provider configuration or credential environment names.

## Attempt

`attempt.json` schema version 2 remains atomically published immediately after freeze and before overlap observation. It includes:

- build identity and root;
- dynamic agent IDs;
- requested non-secret model binding for every session;
- optional actual provider/model identity reported by a successful turn;
- normalized input/output usage and existing termination fields;
- existing trace, frozen Git/workspaces, and sandbox identity/policy.

Provider raw response bodies and credential values are excluded.

## Experiment summary

`experiment.json` schema version 1 contains:

- resolved non-secret experiment configuration;
- build ID and root;
- declaration-ordered durable attempt entries with run name, repetition, attempt ID, and root.

The summary is complete JSON written to a same-directory temporary file and atomically renamed. It is republished only after an attempt is durable. A failed next attempt leaves the prior summary byte-valid.

## Trace

The configured event adds:

- build ID;
- dynamic agent/stage counts;
- re-key count without hidden changed-symbol details;
- run name and repetition;
- requested model binding per agent.

Session/model events may add actual response provider/model identity and optional normalized usage detail. They do not expose private keys, plaintext, unreleased evidence, credential values, or complete provider response payloads.

## Evaluation

Evaluation artifacts remain under each attempt and retain the existing reviewer-selected status model. Experiment summary publication does not classify or aggregate model quality.
