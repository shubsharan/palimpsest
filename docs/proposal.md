# Palimpsest

## A configurable collaborative decipherment puzzle

Palimpsest gives three frontier-model agents different private fragments of a word-substitution cipher and asks them to recover as much of the original text as possible. The agents work concurrently and decide for themselves how to solve. The current runtime supplies ordinary shared Git; a later feature will vary peer communication while preserving team identity and other inputs.

The project is a local puzzle and an observational research artifact. It is not an enterprise application, a hosted experiment service, a hardened adversarial benchmark, or a prescribed multi-agent workflow.

## The Puzzle

Every word type in a prepared text is replaced by another word type under a hidden bijection. Punctuation, capitalization patterns, digits, and paragraph structure remain visible. The result resembles English at the token level while its vocabulary has been systematically reassigned.

Five checked-in block definitions select provenance-pinned targets and references, scientific seeds, and committed natural-prose windows. A deterministic bounded search allocates whole paragraphs across exactly three agents and six stages. Every selected paragraph appears once, and its source order remains recoverable.

Each block produces stationary and re-key twins from one paragraph allocation and base key. Their first three stages are byte-identical. The stationary twin keeps its mappings; the re-key twin changes only selected mappings beginning at stage four while matched controls remain stable.

Trusted build records retain shared anchors, universal sentinels, owner-weighted specialists, matched stable controls, allocation metrics, rejected tiers, and manipulation checks. Agent-visible stages contain none of those labels, keys, expectations, or results.

Ordered immutable stages are construction artifacts; their release timing belongs to the runtime. Feature 013 keeps the current arithmetic schedule and re-key selection for existing runs. Later features will add canonical communication/key conditions and the frozen study schedule without rebuilding block bytes.

## The Agents

The manifest also declares direct provider connections and named model profiles. A run condition can assign one profile to every agent or an ordered profile per agent. This supports homogeneous and mixed-model conditions across OpenAI, Anthropic, Google, and OpenAI-compatible endpoints without provider logic in the puzzle runtime.

Provider credentials are read only from named environment variables. They are not valid literal configuration values and are excluded from traces, attempt records, experiment summaries, error text, and command sandboxes. The runner does not silently fall back to another provider or retry an attempt.

Persistent model sessions begin together and remain independent. Each receives the same concise objective, team identity, schedule, limits, tools, references, and evaluation boundary.

The implemented runtime gives the team one shared Git repository and peer activity. Feature 014 will add isolated conditions with independent usable repositories and no peer visibility while keeping team identity and non-communication inputs equal across paired conditions.

Instructions make the team and currently available channel explicit. They do not reveal the key regime, special word sets, scoring expectations, roles, workflows, required artifacts, or a decoding algorithm.

Agents receive local file, shell, and code tools; their currently released private evidence; a target-excluded reference corpus; ordinary shared Git; an aggregate reconstruction checker; and a way to wait for relevant activity. A waiting session may resume when private evidence or visible Git state changes. Other sessions do not synchronize with it.

Git use remains voluntary and unmetered. Agents may work independently, collaborate continuously, centralize the solution, duplicate effort, create conflicts, relay raw evidence, or ignore the repository.

## The Run

The runner supplies an environment rather than a work plan.

- Evidence stages appear on a fixed monotonic schedule independent of model turns, token use, Git activity, checker calls, or apparent progress.
- Sessions may take as many model responses, tool calls, checker calls, and, when available, collaboration cycles as their cumulative provider-reported token budgets and the attempt wall-time limit permit.
- An agent's final response ends only that session. Token exhaustion ends only the affected session. The wall-time cutoff stops every active session.
- There are no rounds, launch barriers, assigned turns, publication slots, required commits, prescribed branches, checkpoints, or submission schemas.
- Standard sandboxing and secret handling protect the host, provider credentials, prepared plaintext, and cipher keys. They do not constrain solving behavior.

Private evidence lives outside Git so an agent does not commit it accidentally during ordinary work. The runner does not inspect or reject Git content if an agent deliberately copies material into a visible repository.

## Checking Work

An agent may check a candidate reconstruction against only the private evidence currently visible to that agent. The checker returns aggregate matched-word count, total-word count, coverage, and accuracy, or a plain execution error.

It never returns correct words, expected words, mismatch locations, unreleased results, peer-private results, or information about a hidden re-key. Repeated checking and attempts to exploit the aggregate signal remain behavior to observe.

## Final Evaluation

At the wall-time cutoff, or after all sessions have ended, the runner freezes every repository and agent workspace. It publishes the durable attempt before optional overlap observation.

A reviewer then inspects the frozen work and explicitly selects the workspace, command, and output path that best represent its solver. Palimpsest does not require a solver manifest, language, canonical file name, private deliverable, or prescribed team output.

The selected code runs against the complete ciphertext without the oracle, peer evidence, provider credentials, host files, or public network access. Evaluation reports a deterministic reconstruction score or a clear execution status.

## Research Records

An experiment builds its puzzle once, then executes conditions and repetitions sequentially. Sessions inside one attempt remain concurrent. After each durable attempt, an atomically replaced `experiment.json` indexes the resolved non-secret condition and attempt root. A later failure cannot erase earlier attempts.

Paired build records retain block identity, source window, allocation, both variant identities, oracle metadata, and deterministic manipulation checks. Current attempt records retain the selected re-key build, requested provider/model binding, optional actual response identity, normalized provider-reported usage, termination, model and tool activity, stage releases, Git history, frozen work, overlap observations, reviewer selection, execution result, and score. Condition, communication-mode, and frozen-protocol fields belong to Features 014 and 015. Records do not retain complete provider response payloads or credential values.

This chronology supports qualitative review of how particular models used private evidence, Git, checking, and prior rules before and after contradictory evidence. It also makes the exact declared puzzle and model condition recoverable for sharing.

## Claim Boundary

Palimpsest supports controlled comparison of declared local runs. Fixed puzzle inputs, construction, checking, and scoring are reproducible; live model choices, provider serving behavior, scheduling, Git interleavings, reviewer judgment, and collaboration outcomes are not.

A team result does not by itself isolate the value of communication. A hidden re-key creates an opportunity to observe rule revision; it does not guarantee a legible belief or prove semantic reasoning. Provider-reported token accounting is retained as evidence but is not assumed equivalent across providers.

The project does not claim to certify collaboration or belief revision, prevent raw communication, exclude source recognition, provide automatic statistical analysis, or establish a general capability benchmark. Those limitations define how findings should be reported; they do not prevent running the puzzle.
