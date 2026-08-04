# Palimpsest

## A Configurable Collaborative Decipherment Puzzle

Palimpsest gives a team of frontier-model agents different private fragments of a word-substitution cipher and asks them to recover as much of the original text as possible. Agents work concurrently and decide for themselves how to solve. Researchers vary the puzzle, evidence schedule, model assignment, and communication environment through declarations rather than runner changes.

The project is a local puzzle and an observational research artifact. It is not a hosted experiment service, a hardened benchmark, or a prescribed multi-agent workflow. The science determines what code belongs: infrastructure exists only to create controlled puzzle conditions, preserve model behavior, and score the resulting work.

## The Puzzle

Every word type in a prepared text is replaced by another word type under a hidden bijection. Punctuation, capitalization patterns, digits, and paragraph structure remain visible. The result resembles English at the token level while its vocabulary has been systematically reassigned.

Each named run declares a source, agent count, release schedule, and optional re-key boundary. Deterministic preparation derives the source window, agent IDs, allocation, construction randomness, package identity, and artifact path, then produces one flat `FixturePackage` containing ordered private stages for that realized key regime, provenance, trusted oracle data, manipulation checks, and the scoring contract.

Fixture geometry is an experimental input. A researcher can prepare different agent counts, stage counts, sources, schedules, and re-key boundaries without changing runner code. Search limits and construction mechanics remain engine-owned policy rather than authored configuration.

Trusted package data records allocation and manipulation checks. Agent-visible stages contain no plaintext, key, oracle, expectation, scientific label, or manipulation-check result.

## Research Questions

Palimpsest is designed to make behavior inspectable, not to force a particular analysis. Useful questions include:

- How do models combine incomplete, differently distributed evidence?
- When ordinary peer communication is available, what do agents publish, reuse, ignore, or conflict over?
- How do agents respond when a previously useful substitution rule stops working after a hidden re-key?
- How do puzzle geometry, timing, model assignment, and resource limits change tool use, checking, publication, and reconstruction quality?
- Which observed failures come from model behavior, missing integration, or research infrastructure?

One run cannot isolate every cause. Comparisons are scientifically meaningful only when their declared non-treatment inputs are held equal and the retained records support the claimed contrast.

## Treatments

An `ExperimentManifest` maps human-readable run IDs to concrete runs in execution order. Each run declares one source, team size, uniformly applied model, `shared` or `isolated` communication, release durations, cutoff, spend ceiling, and optional re-key or token limit. Conventional credential variables and the aggregate spend authorization are derived.

Shared runs give the team one ordinary peer-visible Git origin and may expose one append-only public discussion room. Isolated runs give each agent an independent usable origin and no peer evidence or activity. Communication is declared directly rather than encoded in fixed condition IDs, so researchers can compose the comparisons their question requires.

Stationary and re-keyed runs provide another treatment axis. Paired packages can share the same allocation and pre-boundary evidence while changing mappings only at the declared re-key boundary. The package's deterministic checks establish that mechanical relationship; model behavior remains an empirical outcome.

Team identity, objective, private evidence allocation, schedule, model resources, tools other than peer communication, and evaluation boundary should remain equal across communication-paired runs. The manifest makes these inputs reviewable instead of generating them through a hidden study state machine.

## Agent Experience

Persistent model sessions begin together and receive the same concise objective, team identity, puzzle family, schedule, limits, currently released private evidence, and evaluation boundary. Evidence appears on the declared monotonic schedule independent of model turns, tool use, checking, or apparent progress.

Every assigned origin begins with the same neutral `solver.py` scaffold. Git commands are model-chosen and unmetered, but only code pushed to the assigned origin's literal `main` branch can receive aggregate checker feedback or a final grade. Agents may work independently, centralize, duplicate effort, create conflicts, share raw evidence when a channel exists, or publish nothing.

The runner imposes no roles, turns, checkpoints, consensus, intermediate reports, branch workflow, commit cadence, or decoding method. A run ends at its cutoff or when all sessions finish. Optional token limits end only the affected session; infrastructure does not repair, merge, or reinterpret model work.

## Observation And Evaluation

The append-only trace records evidence releases, requested and actual model identities, normalized usage, responses, safe provider-returned summaries, tool and checker calls, Git and room activity, termination, freezing, evaluation, and infrastructure errors. It excludes credentials, hidden reasoning, complete provider payloads, oracle data, keys, and unreleased evidence.

After sessions stop, the runner freezes available repositories and workspaces. It evaluates every canonical origin: once for a shared origin and once per agent origin in an isolated run. Missing publication, invalid solvers, and failure to integrate remain explicit outcomes; no reviewer or runtime selects a best isolated solver.

Checking and evaluation capture the literal pushed `main` commit, materialize a Git-free tree, and run `python3 solver.py` in the isolated evaluator against the appropriate ciphertext. The agent receives only aggregate coverage and accuracy from checking. Final scoring is deterministic for fixed package and solver bytes.

One atomic `RunRecord` freezes the resolved secret-free configuration, fixture and sandbox identities, sessions, trace identity, topology, infrastructure status, and every evaluation. Optional overlap and process analyses happen after publication and never change run success, score, or frozen evidence. Process grading keeps deterministic outcome facts separate from two independent evidence dossiers of observable epistemic, social, and instrumental mechanisms. It declares the team or origin evaluation unit, preserves typed disagreement and missingness, exposes layered non-causal failure accounts and provenance, and evaluates every canonical origin without selecting a best result. Ratings remain advisory summaries rather than the primary finding. A directory with a trace but no final record is simply an interrupted run.

## Claim Boundary

Palimpsest supports controlled local comparisons and qualitative inspection of model behavior. Fixture preparation, manipulation checks, staged inputs, published-commit capture, solver execution, and scoring are reproducible for fixed inputs. Live model choices, provider serving behavior, scheduling interleavings, Git choices, collaboration, and interpretation are not.

Cross-run reports are descriptive unless the operator declares a treatment, matching fields, experimental unit, and clustering rule and the retained inputs satisfy that design. The grader does not collapse dimensions into a leaderboard, infer hidden mental state, or treat activity volume as collaboration quality.

A communication comparison can describe observed differences under its declared runs; it does not prove a general value of collaboration. A hidden re-key creates an opportunity to observe rule revision; it does not demonstrate belief revision or semantic reasoning. Reconstruction accuracy is a puzzle result, not a complete measure of team quality.

The project does not claim construct validity, source novelty, deterministic model behavior, security against adversarial agents, automatic causal inference, or general benchmark status. Findings must identify the fixture, treatment inputs, models, retained run records, and confounds that support their scope.
