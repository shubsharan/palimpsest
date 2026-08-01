# Research: Lean Experiment Engine

## Decision: Author named runs, not construction records

The useful scientific controls are source, geometry, model, communication, schedule, re-keying, token limit, and spend. Run map keys are readable selectors used by the CLI and artifacts. Window bounds, word counts, source hashes, formats, references, seeds, fixture IDs, package paths, variants, assignments, capability objects, labels, and allocation thresholds are derived or removed because exposing them adds configuration burden without adding an experimental choice.

## Decision: One uniform model and inferred environment

Each run applies one model profile to inferred agents. `shared` derives shared Git and the room; `isolated` derives private Git and no room. Provider names imply conventional credential variables. One run ceiling is the sole authored monetary limit, and the experiment maximum is their sum. This keeps authorization explicit without duplication.

## Decision: Human durations, frozen milliseconds

Authors use strict integer `ms`, `s`, `m`, or `h` strings. The resolver rejects ambiguous or malformed values and freezes exact milliseconds in records, preserving convenience at authoring time and precision in evidence.

## Decision: Flat realized packages

The deterministic builder owns source-window discovery, construction randomness, allocation policy, package identity, and paths. Each generated package represents exactly one stationary or re-keyed regime and records its provenance and boundary. It exposes no reference corpus and stores no variant catalog. Paired construction checks still establish equal allocation and pre-boundary evidence.

## Decision: Validate immediately before access

`puzzle:build` prepares derived packages from the exact config. Validation verifies every package and relationship, probes the sandbox, and runs one provider-free smoke. Provider-backed execution requires explicit spend authorization and repeats the gate before constructing provider sessions. Missing, drifted, invalid, or unauthorized inputs therefore produce zero provider requests.

## Decision: Preserve observational runtime semantics

Runs execute sequentially and agents concurrently. Git and collaboration remain model-chosen. A session failure does not cancel peers; interrupted traces are not synthetic records; later runs stop; and no retry, replacement, merge, repair, or resume occurs. Every canonical pushed `main` is evaluated, including missing publication and missing integration outcomes.

## Decision: Keep evidence complete and appendable

One strict `RunRecord` freezes secret-free inputs and results, while `trace.jsonl` preserves chronology. Re-evaluation and overlap analysis validate the package, trace, topology, and frozen trees before atomically appending history. No best result is selected, and provider payloads, credentials, keys, oracle data, references, and unreleased evidence remain absent.
