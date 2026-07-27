# Palimpsest

## A distributed decipherment puzzle for frontier language models

Palimpsest gives three frontier-model agents different private fragments of a word-substitution cipher and asks them to recover as much of the original text as possible. The agents work concurrently, share an ordinary Git repository, and decide for themselves how to solve and coordinate.

The project is a puzzle and an observational research artifact. It is not an enterprise application, a hardened adversarial benchmark, or a prescribed multi-agent workflow.

## The Puzzle

Every word type in a prepared text is replaced by another word type under a hidden bijection. Punctuation, capitalization patterns, digits, paragraph structure, and chapter boundaries remain visible. The result resembles English at the token level while its vocabulary has been systematically reassigned.

The prepared ciphertext is divided into three private contiguous streams. Each agent receives one stream in six immutable stages on a shared wall-clock schedule. Earlier stages remain available exactly as released.

The first three stages use one substitution key. At the shared transition into the later stages, a controlled subset of mappings changes across all three streams while the remaining mappings stay valid. The transition is hidden from the agents. It is not announced in the prompt, stage names, checker, or repository.

This partial re-key exists to create a simple behavioral question: after agents have had time to form and share a useful rule, what happens when later evidence shows that part of the rule is no longer valid? They may notice quickly, continue forcing the old rule, revise selectively, restart, disagree, or never detect the change. Palimpsest records what they do without requiring any particular response.

## The Team

Three persistent model sessions begin together and remain independent. Each receives the same concise instructions except for its identity and private paths:

> You are Agent N, one of three agents working concurrently to solve Palimpsest. Each agent receives different private evidence. Your team shares a Git repository; use it to coordinate, exchange code and compact findings, review one another's work, and assemble the best solver you can. The other agents are working at the same time. Choose your own roles, strategy, branches, files, and collaboration cadence. Avoid committing raw ciphertext or reconstructed prose.

The instruction makes the team and communication channel explicit because optional collaboration should not be invisible. It does not recommend a decoding algorithm, assign roles, impose rounds, require a Git operation, or ask for mappings, hypotheses, confidence values, checkpoints, or intermediate reasoning artifacts.

Agents receive local file, shell, and code tools; their currently released private evidence; a target-excluded reference corpus; ordinary shared Git; an aggregate reconstruction checker; and a way to wait for new activity. A waiting session may resume when private evidence or peer-visible Git state changes. Other sessions do not synchronize with it.

Git is the supplied peer communication channel, but its use remains voluntary and unmetered. Agents may work independently, collaborate continuously, centralize the solution, duplicate effort, create conflicts, relay raw evidence, or ignore the repository. The request to share code and compact findings instead of raw content is guidance, not an enforced validity rule.

## The Run

The runner supplies an environment rather than a work plan.

- Evidence stages appear on a fixed monotonic schedule independent of model turns, token use, Git activity, checker calls, or apparent progress.
- Sessions may take as many model responses, tool calls, checker calls, and collaboration cycles as their cumulative model-token budgets and the run's wall-time limit permit.
- An agent's final response ends only that session voluntarily. Token exhaustion ends only the affected session. The wall-time cutoff stops every session still active.
- There are no rounds, barriers after launch, assigned turns, publication slots, required commits, prescribed branches, checkpoint cadences, or submission schemas.
- Standard sandboxing and secret handling protect the host, provider credentials, prepared plaintext, and cipher keys. These are operational protections, not controls on solving behavior.

Private evidence lives outside the Git checkout so an agent does not commit it accidentally with ordinary repository work. The runner does not inspect or reject Git content in order to enforce that separation once an agent deliberately copies material into the repository.

## Checking Work

An agent may check a candidate reconstruction against only the private evidence currently visible to that agent. The checker returns aggregate matched-word count, total-word count, coverage, and accuracy, or a plain execution error.

The checker never returns correct words, expected words, mismatch locations, unreleased results, peer-private results, or information about the hidden transition. Calls are not rate-limited beyond the run's token and wall-time constraints. Repeated checking or attempts to exploit the aggregate signal are model behavior to observe.

## Final Evaluation

At the wall-time cutoff, or after all three sessions have ended, the runner freezes the shared repository and agent workspaces.

A reviewer then inspects the team's frozen work, selects a command and output path that best represent how the repository should solve the complete ciphertext, and records that choice before execution. Palimpsest does not require the agents to provide a solver manifest, use a particular language, place code at a canonical path, or create a private deliverable.

The selected code runs against the complete ciphertext without access to the prepared plaintext or cipher keys. Evaluation reports one of four outcomes:

- `scored`: reconstruction output exists and receives deterministic token-level scoring;
- `not-runnable`: the reviewer cannot identify a credible execution path;
- `no-output`: the selected execution completes without a reconstruction;
- `execution-error`: execution fails or exceeds its evaluation limit.

Missing, extra, and unresolved tokens count as incorrect where a reconstruction can still be scored. Reconstruction quality is the primary result. The score reports matched words, total words, coverage, and accuracy; agents are not required to expose the mappings or beliefs that produced them.

## Observation

Palimpsest retains normalized model-turn summaries, final response text, full tool arguments and results, session lifecycle, stage releases, aggregate checker calls, Git history, frozen workspaces, reviewer selection, execution result, and reconstruction score. It does not retain the provider's complete raw response payload. The resulting chronology supports qualitative review of how agents used prior rules before and after contradictory evidence, how they communicated, and whether later code or notes reflect revision.

A deliberately narrow post-run observer may report obvious exact or normalized long-span overlap between committed content and private raw evidence. It does not block a push, warn an agent, change a score, invalidate a run, or attempt to detect compression, encoding, steganography, or every possible relay.

No-Git work, raw sharing, source recognition, unusual encodings, checker exploitation, process workarounds, early stopping, stale beliefs, and failed collaboration remain outcomes. Infrastructure failure is reserved for the runner failing to provide the declared evidence, tools, Git access, cutoffs, checker, freeze, or evaluation behavior.

## Interpretation

Palimpsest directly measures reconstruction of one prepared text under one configured run. Its traces can show behavior consistent with coordination, semantic inference, selective revision, anchoring, duplication, or exploitation, but the puzzle does not certify any of those as general model traits.

The three-agent design combines additional compute, distributed evidence, and possible collaboration. A strong team result does not by itself isolate the value of communication, and an independent-work result is not invalid. The hidden partial re-key creates an opportunity to observe belief review; it does not guarantee that a model will form, expose, or revise a legible belief.

The relevant literature motivates the puzzle without defining release gates or a required solve path. Word-level decipherment relates to classic unsupervised decipherment and lexicon-induction work. Contextual belief-management and multi-agent failure studies motivate examining revision and coordination traces, while their constructs should not be treated as validated by this single compound task.

## Difficulty Parameters

The active puzzle profile is controlled by:

1. source text and preparation seed;
2. text length and chapter geometry;
3. substitution scope;
4. changed mapping subset and token-mass target;
5. three private shard assignments;
6. six stage offsets and the hidden shared transition;
7. model and per-agent cumulative token budget;
8. run wall-time cutoff;
9. reference-corpus snapshot; and
10. final scoring policy.

These parameters change the environment supplied to agents. The current build manifest retains the derived build identity, stage geometry, changed-symbol set, artifact paths, and per-stage hashes. The attempt trace retains the attempt ID plus token, wall-time, stage-interval, agent-count, and stage-count settings. The CLI seed, changed-token-mass target, adapter, and model are inputs but are not independently repeated in those artifacts; operators who need them as standalone metadata must retain their invocation record. None of these parameters introduces roles, rounds, required artifacts, or behavioral pass conditions.

## References

"Contextual Belief Management in Large Language Models." arXiv:2605.30219.

Cemri et al. "Why Do Multi-Agent LLM Systems Fail?" (MAST), v3. arXiv:2503.13657.

Chen et al. "Premise Order Matters in Reasoning with Large Language Models." arXiv:2402.08939.

Ravi and Knight. "Deciphering Foreign Language." ACL 2011.

Knight et al. "Unsupervised Analysis for Decipherment Problems." ACL 2006.

Conneau et al. "Word Translation Without Parallel Data." arXiv:1710.04087.

Artetxe, Labaka, and Agirre. "A Robust Self-Learning Method for Fully Unsupervised Cross-Lingual Mappings of Word Embeddings." ACL 2018.
