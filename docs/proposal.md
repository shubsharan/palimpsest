# Palimpsest

## A configurable collaborative decipherment puzzle

Palimpsest gives three frontier-model agents different private fragments of a word-substitution cipher and asks them to recover as much of the original text as possible. The agents work concurrently and decide for themselves how to solve. Communication availability varies by declared condition: shared conditions expose ordinary peer Git, while isolated conditions preserve team identity without peer visibility.

The project is a local puzzle and an observational research artifact. It is not an enterprise application, a hosted experiment service, a hardened adversarial benchmark, or a prescribed multi-agent workflow.

## The Puzzle

Every word type in a prepared text is replaced by another word type under a hidden bijection. Punctuation, capitalization patterns, digits, paragraph structure, and chapter boundaries remain visible. The result resembles English at the token level while its vocabulary has been systematically reassigned.

One experiment manifest selects a target from the checked-in corpus registry, an inclusive one-based chapter range, target-excluded references, a seed, agent and stage counts, a release interval, and zero or more partial re-keys. The same inputs reproduce the same puzzle bytes and build identity.

The prepared ciphertext is divided into one private contiguous stream per agent. Every stream has the same number of immutable stages, released on a shared wall-clock schedule. Earlier stages remain available exactly as released.

At each configured re-key boundary, a deterministic subset of mappings changes across every stream while the remaining mappings stay valid. Each revision is derived from the immediately preceding key. These transitions are hidden from agents: prompts, stage names, checker results, and their agent-visible Git do not announce them.

The checked-in baseline retains the original research condition: three agents, six stages, and one partial re-key beginning at stage four. Other manifests can vary those dimensions so long as the corpus can support the requested geometry.

## The Agents

The manifest also declares direct provider connections and named model profiles. A run condition can assign one profile to every agent or an ordered profile per agent. This supports homogeneous and mixed-model conditions across OpenAI, Anthropic, Google, and OpenAI-compatible endpoints without provider logic in the puzzle runtime.

Provider credentials are read only from named environment variables. They are not valid literal configuration values and are excluded from traces, attempt records, experiment summaries, error text, and command sandboxes. The runner does not silently fall back to another provider or retry an attempt.

Persistent model sessions begin together and remain independent. Each receives the same concise objective, team identity, private evidence allocation, schedule, limits, tools, references, and evaluation boundary. Only channel availability differs between communication-paired prompts.

Shared conditions state that the team has a shared Git repository and peer activity. Isolated conditions state that peer communication is unavailable and give each agent an independent Git repository. Both state that the other agents are working concurrently on different private evidence.

The instruction makes team identity and condition-specific channel availability explicit. It does not reveal the key regime, special word sets, scoring expectations, roles, workflows, required artifacts, or a decoding algorithm.

Agents receive local file, shell, and code tools; their currently released private evidence; a target-excluded reference corpus; Git appropriate to the communication condition; an aggregate reconstruction checker; and a way to wait for relevant activity. A waiting session may resume when private evidence or visible Git state changes. Other sessions do not synchronize with it.

Git use remains voluntary and unmetered in every condition. In shared conditions agents may work independently, collaborate continuously, centralize the solution, duplicate effort, create conflicts, relay raw evidence, or ignore the repository. In isolated conditions agents can use their own Git history but cannot observe peer repositories, evidence, or activity.

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

Attempt records retain the block, condition, communication mode, key regime, protocol identity, requested provider/model binding, optional actual response identity, normalized provider-reported usage, termination, model and tool activity, stage releases, all Git histories, frozen work, overlap observations, reviewer selection, execution result, and score. They do not retain complete provider response payloads or credential values.

This chronology supports qualitative review of how particular models used private evidence, Git, checking, and prior rules before and after contradictory evidence. It also makes the exact declared puzzle and model condition recoverable for sharing.

## Claim Boundary

Palimpsest supports controlled comparison of declared local runs. Fixed puzzle inputs, construction, checking, and scoring are reproducible; live model choices, provider serving behavior, scheduling, Git interleavings, reviewer judgment, and collaboration outcomes are not.

A team result does not by itself isolate the value of communication. A hidden re-key creates an opportunity to observe rule revision; it does not guarantee a legible belief or prove semantic reasoning. Provider-reported token accounting is retained as evidence but is not assumed equivalent across providers.

The project does not claim to certify collaboration or belief revision, prevent raw communication, exclude source recognition, provide automatic statistical analysis, or establish a general capability benchmark. Those limitations define how findings should be reported; they do not prevent running the puzzle.
