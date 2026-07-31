# Palimpsest

## A configurable collaborative decipherment puzzle

Palimpsest gives three frontier-model agents different private fragments of a word-substitution cipher and asks them to recover as much of the original text as possible. The agents work concurrently and decide for themselves how to solve. One canonical condition varies peer communication and key regime while preserving team identity and other inputs.

The project is a local puzzle and an observational research artifact. It is not an enterprise application, a hosted experiment service, a hardened adversarial benchmark, or a prescribed multi-agent workflow.

## The Puzzle

Every word type in a prepared text is replaced by another word type under a hidden bijection. Punctuation, capitalization patterns, digits, and paragraph structure remain visible. The result resembles English at the token level while its vocabulary has been systematically reassigned.

Five checked-in block definitions select provenance-pinned targets and references, scientific seeds, and committed natural-prose windows. A deterministic bounded search allocates whole paragraphs across exactly three agents and six stages. Every selected paragraph appears once, and its source order remains recoverable.

Each block produces stationary and re-key twins from one paragraph allocation and base key. Their first three stages are byte-identical. The stationary twin keeps its mappings; the re-key twin changes only selected mappings beginning at stage four while matched controls remain stable.

Trusted build records retain shared anchors, universal sentinels, owner-weighted specialists, matched stable controls, allocation metrics, rejected tiers, and manipulation checks. Agent-visible stages contain none of those labels, keys, expectations, or results.

Ordered immutable stages are construction artifacts; their release timing belongs to the runtime. The four-condition runtime releases them at 0, 5, 10, 20, 30, and 40 minutes and ends the attempt at 60 minutes. The frozen study protocol prepares the five deterministic block builds before calibration behavior begins.

## The Agents

The manifest declares direct provider connections, named model profiles, and one fixed ordered three-agent assignment used in every cell. It supports OpenAI, Anthropic, Google, and OpenAI-compatible endpoints without provider logic in the puzzle runtime.

Provider credentials are read only from named environment variables. They are not valid literal configuration values and are excluded from traces, attempt records, experiment summaries, error text, and command sandboxes. The runner does not silently fall back to another provider or retry an attempt.

Persistent model sessions begin together and remain independent. Each receives the same concise objective, team identity, schedule, limits, tools, references, and evaluation boundary.

Shared conditions give the team one peer-visible Git repository and shared Git activity. A manifest switch may also give shared agents one append-only public discussion room for strategy and ideas. Isolated conditions give each agent an independent usable repository and owner-only Git activity and never expose the room. Team identity and every non-communication input remain equal across paired conditions.

Instructions identify the puzzle as a word-substitution cipher, make the team and currently available channel explicit, and declare the one graded interface: `origin/main:solver.py`. They do not reveal the key regime, special word sets, scoring expectations, roles, workflows, or a decoding algorithm.

Agents receive local file, shell, and code tools; their currently released private evidence; a target-excluded reference corpus; an assigned ordinary Git origin preseeded with the same neutral `solver.py`; a published-solver checker; and a way to wait for visible activity. In enabled shared tests they may post to and page through the public room, and accepted posts become visible activity for every teammate. Other sessions do not otherwise synchronize.

Git commands remain model-chosen and unmetered, but only code pushed to the assigned origin's `main` branch can receive checker feedback or a final grade. Agents may work independently, collaborate continuously, centralize the solution, duplicate effort, create conflicts, or relay raw evidence; the runner does not prescribe roles, turns, commit sequences, or merge policy.

## The Run

The runner supplies an environment rather than a work plan.

- Evidence stages are privately prepared and atomically appear on the manifest-declared monotonic schedule independent of model turns, token use, trace latency, Git activity, checker calls, or apparent progress.
- Sessions may take as many model responses, tool calls, checker calls, and, when available, collaboration cycles as the declared attempt wall-time and optional cumulative token limit permit.
- An agent's final response ends only that session. When enabled, token exhaustion ends only the affected session. The wall-time cutoff stops every active session.
- There are no rounds, launch barriers, assigned turns, publication slots, required commits, prescribed branches, checkpoints, or submission schemas.
- Standard sandboxing and secret handling protect the host, provider credentials, prepared plaintext, and cipher keys. They do not constrain solving behavior.

Private evidence lives outside Git so an agent does not commit it accidentally during ordinary work. The runner does not inspect or reject Git content if an agent deliberately copies material into a visible repository.

## Checking Work

An agent may invoke `check_published_solver`, which captures only the assigned origin's literal current `refs/heads/main`, runs the pinned Git-free tree against ciphertext assembled from one frozen view of ordered trusted release records, validates its output without opening oracle plaintext or checker truth, removes the capture, and only then returns an outcome. A later force-push cannot invalidate the captured tree. The fresh execution receives no agent workspace, other Git refs, agent-writable evidence source, reference corpus, oracle path, or correctness data. The checker returns the commit, execution and output-validity status, ciphertext and output word counts, and bounded word coverage, or a commit-aware submission error; trusted machinery and cleanup failures remain infrastructure failures.

It never accepts a local path and never returns matched counts, accuracy, correctness deltas, correct words, expected words, mismatch locations, unreleased results, peer-private results, or information about a hidden re-key. Correct and incorrect outputs with the same length receive identical validation feedback. Repeated publication and checking remain behavior to observe.

## Final Evaluation

At the wall-time cutoff, or after all sessions have ended, the runner freezes every repository and agent workspace. It publishes the durable attempt before optional overlap observation.

Palimpsest evaluates every condition-canonical frozen origin without reviewer selection. Shared conditions evaluate the one shared origin once as the realized team product. Isolated conditions evaluate all three private origins independently and record that no integrated team product exists. Each evaluation uses the same fetch-and-materialize transaction, records the captured `refs/heads/main` commit before running the declared `python3 solver.py` interface, and cleans the temporary tree after use; symbolic `HEAD`, later ref changes, other refs, and uncommitted local candidates cannot select or supplement graded code.

Each captured tree runs read-only against the complete ciphertext and writes only to bounded container tmpfs, without a writable host bind, frozen repository, oracle, peer evidence, references, provider credentials, host siblings, or public network access. After exit, the host validates one declared file in hidden staging and atomically publishes it for scoring. Evaluation reports the exact commit, a deterministic aggregate score or clear execution status, and post-freeze diagnostics. A position-wise collective ceiling may compare evaluated origins, but the runner never creates a synthetic reconstruction. Integration gap is reported only when a realized product and meaningful multi-origin ceiling both exist.

## Research Records

A study prepares all five builds and an immutable design receipt before calibration sessions begin. Calibration executes four condition cells; validation executes sixteen cells under four balanced orders. Attempts remain sequential while the three sessions inside one attempt remain concurrent. Each phase summary records launch reservations, durable attempts, resource authorization, and explicit replacement lineage without selecting or aggregating outcomes.

Paired build records retain block identity, source window, evidence and control tiers, allocation, both variant identities, oracle metadata, and deterministic manipulation checks. Attempt records retain study provenance, condition and derived treatment, declared channel mode, selected build, resolved schedule and cutoff, secret-free protocol snapshot and digest, requested provider/model bindings, optional actual response identities, normalized provider-reported usage, exact provider-returned reasoning-summary items when available, termination, model and tool activity, accepted public messages, stage releases, native frozen Git topology, overlap observations, every canonical-origin result, diagnostics, realized team-product status, collective ceiling, nullable integration gap, behavior review, and final artifact provenance. Records do not retain hidden reasoning, complete provider response payloads, or credential values.

This chronology supports qualitative review of how particular models used private evidence, Git, checking, and prior rules before and after contradictory evidence. It also makes the exact declared puzzle and model condition recoverable for sharing.

## Claim Boundary

Palimpsest supports controlled comparison of declared local runs. Fixed puzzle inputs, construction, checking, and scoring are reproducible; live model choices, provider serving behavior, scheduling, Git interleavings, reviewer judgment, and collaboration outcomes are not.

A team result does not by itself isolate the value of communication. A hidden re-key creates an opportunity to observe rule revision; it does not guarantee a legible belief or prove semantic reasoning. Provider-reported token accounting is retained as evidence but is not assumed equivalent across providers.

The project does not claim to certify collaboration or belief revision, prevent raw communication, exclude source recognition, provide automatic statistical analysis, or establish a general capability benchmark. Those limitations define how findings should be reported; they do not prevent running the puzzle.
