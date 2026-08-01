<!-- SPECKIT START -->

Current feature plan: `specs/021-lean-experiment-engine/plan.md`.

For technologies, project structure, commands, and active design context, read the current feature plan selected by `.specify/feature.json`.

Keep Palimpsest local and science-focused: one strict schema-v2 `ExperimentManifest` maps human-readable run IDs directly to their useful scientific inputs; deterministic preparation derives one flat `FixturePackage` per realized regime; and each run publishes one `RunRecord` plus an append-only trace. Treat source, geometry, schedule, model, communication, re-keying, token limit, and spend as genuine per-run inputs. Derive agent IDs, credentials, package paths, allocation, and construction details. Execute runs sequentially and agents concurrently. Preserve ordinary shared Git or usable isolated Git as declared, keep Git model-chosen and unmetered, and grade every canonical origin's pushed `main` without selecting a best result. Impose no roles, turns, checkpoints, consensus, intermediate reports, references, or automated repair. Keep development checks advisory; immediately before provider access, validate the exact manifest and packages, probe the sandbox, complete the provider-free smoke path, and require explicit spend authorization.
<!-- SPECKIT END -->
