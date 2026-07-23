# Palimpsest

## A distributed decipherment puzzle for frontier language models

**The puzzle:** three agents share a git repository and fragments of a novel whose every word has been swapped by a hidden dictionary that changes partway through the process and must restore the original text.

---

## Overview

A good puzzle for frontier models is simple to explain, complex to solve rather than setup, graded by a deterministic oracle, and instrumented so that *how* a model fails is as legible as whether it succeeds.

The enabling observation is that for any deterministic, seeded transformation of a text, the original is a free oracle. Project Gutenberg holds roughly seventy thousand volumes, so content exists at scale with zero manual authoring. The design problem then collapses into a single choice: pick a transformation that destroys the sufficiency of *cheap* surface statistics while preserving recoverability through meaning and structure. Most transformations fail this. Shuffled chapters fall to stylometry; scrambled sentence order falls to discourse-connective heuristics; parallel-text alignment fell to sentence-length statistics in 1993. Word-level substitution is the most promising candidate we have found, with a caveat below, that *how much* headroom it leaves above strong statistical attack is an empirical question this proposal's first phase exists to answer.

The transformation: every word type is replaced according to a hidden, consistent bijection over the text's own vocabulary. This is a cryptoquote scaled from letters to words, which is a promising sign: letter cryptograms are a beloved puzzle form, and the reason they would make a poor LLM puzzle (frequency analysis solves them cheaply, no semantics required) is exactly what the word-level version repairs. Frequency matching recovers function words; stronger surface methods are expected to recover substantial further structure, and measuring how much is precisely what we're interested in. Our design aim is that low-frequency, semantically ambiguous, and narrative-entity mappings remain unresolved without plausibility judgments made under a global consistency constraint: the same hidden word maps to the same surface word everywhere, across many thousands of tokens. The deeper solution is genuinely deep: it is unsupervised bilingual lexicon induction, treating "corrupted English" as a foreign language and the rest of the corpus as the reference distribution. The corpus is simultaneously the puzzle and the key. That is the puzzle's aha-structure.

Two mechanics extend the core cipher into the failure modes this puzzle most wants to probe:

1. *Distribution*: three agents each hold a contiguous third of the ciphertext and communicate only through a bandwidth-limited channel, so the global dictionary must be recovered from evidence no single agent possesses and no agent can cheaply relay.
2. *Regime change*: at hidden, seeded chapter boundaries, a selected subset of dictionary entries silently re-maps while the rest carry over. Together these make Palimpsest a compound task whose intended demands are semantic and narrative inference realized in an executable artifact, coordination under an information constraint, and selective belief revision under partial invalidation.

---



## The Puzzle

**Text preparation.** A novel is drawn from the low-popularity long tail of Project Gutenberg, Gutenberg boilerplate is stripped, and the text is normalized and tokenized. Then, all proper nouns are regenerated before ciphering. Named entities are detected automatically and consistently replaced with synthetic names drawn from a generator seeded per instance. The regenerated text becomes the ground truth. This single automated step does three jobs at once: it removes the strongest memorization channel (character and place names are what a model may most reliably recall about a book), it destroys the most distinctive identification fingerprint in the ciphertext's vocabulary inventory, and it dissolves the label-symmetry problem in scoring (see Scoring).

**Ciphering.** The vocabulary of the prepared text (typically five to fifteen thousand types) is permuted under a seeded derangement: every type maps to a different type from the same text, so the ciphertext reads as real English words in impossible arrangements. Punctuation, capitalization patterns, digits, and paragraph structure survive.

**Regime changes.** At *S* hidden switch points aligned to chapter boundaries, subject to a minimum segment length (nominally ≥10k tokens), a selected subset of entries re-maps. A randomly chosen rare type may not occur on both sides of a boundary and therefore can generate no contradictory evidence at all. Changed entries are drawn from types occurring at least *k* times in both adjacent segments, stratified across frequency bands, targeting a controlled fraction of token mass, and paired with matched unchanged controls at comparable frequencies. Bijection is preserved by composing the prior key with a derangement over the selected image subset. Each changed entry must differ from both its plaintext identity and its previous ciphertext mapping.

Partial rotation is deliberate over full re-keying. Under full re-keying the optimal response is "discard everything and restart". That's not very fun. Under partial rotation most priors remain valid, so wholesale distrust is as wrong as anchoring, and the agent must determine *which* beliefs to revise. This maps directly onto the failed-stay / failed-update distinction in the contextual-belief-management literature.

**Progressive reveal along a chronological frontier.** Chapters are released across rounds following the novel's own chronology: early rounds expose early chapters, and later chapters unlock round by round to whichever agent owns them. Agents retain private shard ownership and data availability follows the book. Evidence therefore has a genuine arrival time. Consensus forms on early chapters and is challenged by later ones, and the schedule differentiates roles naturally: the first agent establishes the initial dictionary, the middle agent encounters and must diagnose the change, the third validates or rejects the revision against late evidence. The alternative (revealing the start of all three shards simultaneously) would expose post-switch text at round one and blunt the temporal structure. The known cost is asymmetry: later agents hold little private evidence early and spend those rounds on the shared solver and repository state. The reveal schedule is held identical across ablation arms so the asymmetry cancels in comparisons, and "sufficiently contradictory," for latency purposes, is defined by the oracle at generation time — a threshold on contradicting token mass released — not after observing agent behavior.

**Distribution.** Three agents run in isolated sandboxes, each holding one contiguous, chapter-aligned shard. Contiguous rather than interleaved sharding is load-bearing: contiguous shards have scene-biased local statistics, long-tail types appear once locally but several times globally, and switch points sit asymmetrically relative to shard boundaries.

It is not true that an interior switch *requires* communication to diagnose (an agent holding text on both sides of a boundary can in principle detect a systematic key change locally). What genuinely requires communication is **cross-shard discrepancy attribution**: when two agents' committed mappings for the same type disagree, neither can distinguish "the key changed between our regions" from "you made an error" without exchanging evidence. Shard boundaries are therefore placed so that at least one switch falls near a boundary, producing exactly this ambiguity, and one switch falls interior to a shard, producing the locally-diagnosable contrast case.

Communication makes the attribution possible but not automatic. What resolves it is a *pattern*: several mappings failing together, failures localized by book position, matched unchanged controls still holding, later-shard evidence supporting the revised entries. The channel's job is to expose that spatial structure, which no agent can see alone, to let the team recognize that a disagreement is organized by position in the book rather than by which teammate messed up. To carry that structure cheaply, committed dictionary entries include lightweight provenance: supporting chapter range, local occurrence count, confidence, and last validation round. Provenance is exactly the kind of compressed evidence the budget is designed to favor over raw relay.

**The channel.** Agents communicate only through a shared repository, under a per-agent cumulative outbound byte budget enforced server-side. The aggregate is also reported, but the per-agent bound is the operative constraint. Each agent's total outbound allowance must sit below the best tested compressed size of that agent's own shard. The purpose of the budget is stated below in Anticipated Attacks. Briefly, it is not to prevent statistical pooling — pooling compressed evidence is the intended behavior — but to make lossless raw relay strictly dominated, so that agents must *decide* which evidence matters. The repository holds per-regime dictionary files (co-edited, so a merge conflict is two competing hypotheses about a word's meaning), hypothesized switch points, solver code, and notes.

**The run.** *R* rounds, commit order rotated across calibration runs, chapters released along the chronological frontier, and a final synchronized pull-only phase so every agent produces its final output from the same repository state. Each turn an agent pulls, computes privately against its shard with unrestricted local Python, and pushes within budget. No network beyond the repository; executed code may not call external model APIs. Final deliverables go to a private, unbudgeted, per-agent output directory invisible to teammates. Reconstructions cannot live in the repository, since a mostly-solved reconstruction *is* the shard and committing it would launder the budget.

**Solver reproducibility.** The submitted reconstruction must be reproducibly regenerable by the submitted solver from the shard and final repository state. Hand-derived dictionary entries are permitted as *data* the solver consumes — hand-solving the semantic tail is valid behavior — but the pipeline that turns shard plus dictionary into reconstruction must be code, and the grader executes it in a clean, network-disabled environment and compares its output byte-for-byte with the private reconstruction. The best approach is likely a hybrid, and the puzzle celebrates it rather than obscuring it: algorithmic scaffolding for scale, model judgment for ambiguous mappings, executable reproduction of the final result. The point is not to externalize a semantic engine into code: the agent's semantic functionality is a core part of the process.

---



## Demands

Reconstruction quality is the primary score, and the capabilities below are intended demands of the task, observable in the trace.

**Selective belief revision under partial invalidation.** This is the design's primary motivation. Partial rotation operationalizes "prior assumption review under changing data" in its hardest form: most beliefs remain true, so the correct response is neither anchoring nor restart. The contextual-belief-management line (arXiv:2605.30219) is the direct theoretical anchor — it studies when models should update, preserve, or isolate beliefs, and names the failure modes *failed stay* and *failed update*. Palimpsest instruments both separately: accuracy on unchanged mappings after a switch (failed stay = spurious retraction of still-valid beliefs) and accuracy on changed mappings (failed update = anchoring on stale ones), read per-round off repository history. Context-order sensitivity results (premise permutations producing >30% reasoning drops, arXiv:2402.08939) support the broader claim that arrangement of evidence in context materially affects reasoning; the anchoring-circuits work (arXiv:2606.12818) is adjacent but studies numerical anchors in multiple-choice settings and should not be cited as direct evidence for this mechanism.

**Sustained execution of a known pipeline.** The solution technique is published: frequency skeleton, syntactic typing, distributional or embedding alignment against a reference corpus, global constraint propagation, semantic inference for the tail. Frontier models plausibly *know* this. The long-horizon literature predicts execution, not knowledge, is the gap — per-step accuracy degrades as models condition on accumulated errors (arXiv:2509.09677), an effect not fixed by scale, and measured task horizons remain in the low hours (arXiv:2503.14499). Palimpsest makes pipeline progress legible: which stage a team reached is readable from *which classes of words* it recovered.

**Inductive recovery of a hidden function.** The dictionary is a latent bijection recovered from observation. CodeARC (arXiv:2503.23145) is the closest prior structure — 1,114 hidden functions, best model o3-mini at 52.7%, and a diagnostic gap between fitting visible examples (67.6%) and passing the hidden oracle (38.9%). The analogy should be stated carefully: CodeARC is *interactive* synthesis where the agent queries a hidden function and receives feedback, while Palimpsest is largely passive inference over a fixed observation. What transfers is the **grading structure** — differential testing of a candidate function against ground truth — and the general finding that models fit observations without recovering generators. It is motivation, not prediction.

**Coordination under an information constraint.** The budget forces agents to compress evidence into transmissible hypotheses; that compression is where distributed reasoning lives. MAST (arXiv:2503.13657, v3) finds multi-agent failures concentrated in system design (44.2%), inter-agent misalignment (32.3%), and task verification (23.5%). A boundary worth stating so the design is not over-enforced: if one agent becomes the solver and others become evidence-compressors, that is role emergence, which is a success mode in the coordination literature, not a bypass. What is excluded by construction is free centralization of raw text.

**Calibration at the boundary of the recoverable.** Some types are irrecoverable in principle. An optional secondary metric asks agents to attach confidences to dictionary entries, scored by Brier. This imports, at low stakes, the unsolvability-recognition finding (SATBench, arXiv:2505.14615): does the team know what it cannot know, or does it confabulate the tail?

---



## What Statistical Attack Buys: the Baseline Ladder

A strong statistical system can exploit far more than unigram frequency: higher-order pseudo-likelihood, induced syntactic types, repetition and equality patterns, context-signature matching, quadratic assignment, distributional embeddings, frozen masked-LM scoring, capitalization and morphology leakage, and narrative co-occurrence structure. Such methods may recover substantial content vocabulary without anything that should be called semantic reasoning.

We therefore implement a ladder, which is simultaneously the baseline suite and the expected solution path:

1. frequency-rank assignment
2. POS / syntactic-context assignment
3. word n-gram MCMC or simulated annealing
4. context-signature graph alignment
5. embedding alignment (MUSE-style) with constraint propagation
6. frozen neural LM scoring
7. rungs 1–6 with oracle segmentation (isolating decipherment from switch detection)
8. target-identification and retrieval attacks

The interpretive frame follows from the ladder's dual role. Because every rung is something the agent could also build, an agent's score is meaningful *relative to the highest rung it effectively reproduced*. A frontier agent scoring near rung 5 has re-derived known technique; an agent scoring well above rung 6 has done something the ladder cannot account for; an agent scoring below rung 3 has failed at execution despite plausibly knowing the method — and that last outcome, which the long-horizon literature predicts is likely, is the most interesting result the puzzle can produce. We aren't saying the scoring headroom is attributable to semantics, but that the ladder estimates how much headroom remains beyond increasingly expressive statistical attacks.

Whether that headroom exists at a usable magnitude is unknown, and the go/no-go question is not "is the residual semantic?" It is fourfold: strong mechanical methods must not saturate the task; frontier agents must be able to exploit structure beyond them; performance must improve progressively rather than sitting near zero; and difficulty must concentrate where designed — rare content words, narrative entities, ambiguous roles, changed mappings. 

Our initial design runs a compact five-rung version of the ladder (frequency and syntactic typing; pseudo-likelihood optimization; context-graph or distributional alignment; contextual LM scoring; the strongest rung with oracle segmentation — the last isolating whether the switch mechanic creates interesting difficulty or merely breaks every solver indiscriminately). If the gap does not exist, the project can stop because it's pointless.

---



## Anticipated Attacks and Designed Answers

**Target identification.** The most serious threat. Ciphertext exposes the text's exact vocabulary inventory alongside preserved punctuation, capitalization, paragraph structure, and sentence token counts — a strong fingerprint even before decipherment. If the text or a duplicate edition is reachable in any corpus the agent can access, alignment reads off the dictionary directly.

Four defenses, in order of importance: proper-noun regeneration (removes the highest-salience identifying strings and the strongest memorization channel); aggressive deduplication of the in-container reference corpus against the target, including anthologies, alternate editions, and structural fingerprints; long-tail selection; and a **cipher-view canary** — the model is shown only what a solver can see (word inventory, capitalization statistics, structural signature) and asked to identify the source. A generation canary (continue a raw passage) is retained as a secondary screen with a known weakness: recognition is easier than generation.

Residual risk is real. Recognition-level memory of an obscure book still supplies plot priors — though with names regenerated, those priors are substantially weakened. A hardened track using fresh private text (post-cutoff generated fiction, or licensed unpublished text) is specified in Open Decisions as the fallback if Phase 0 shows Gutenberg cannot be made safe.

**Channel exploitation, and what the budget is actually for.** The information content of a complete 8,000-entry permutation, given shared vocabulary ordering, is log₂(8000!) ≈ 92,200 bits ≈ 11.3 KiB. A 27,000-token shard under naive fixed-width symbol coding is ~13 bits/token ≈ 42 KiB, and considerably less under adaptive entropy coding — plausibly 20–35 KiB.

Two distinct mechanisms secure the channel, and they must not be conflated. **Canonicalization closes side channels.** A byte cap alone is not an information bound — bits ride in filenames, commit messages, author fields, timestamps, branch and tag names, object-ID selection, push counts, and rejection patterns — so the raw pre-receive hook is replaced by a canonical message object: one append-only message per agent per turn, fixed path, fixed branch, metadata normalized server-side, re-serialized canonically before counting, exactly one push per turn. Git remains the visible interface and the audit trail; it is not the security boundary. **The budget sweep addresses capacity.** Canonicalization does nothing to stop an optimally compressed shard riding inside the legitimate payload, so the design stands on an explicit feasibility criterion: **there must exist a budget interval in which agents can transmit a useful evolving belief state — dictionaries with provenance, switch hypotheses, solver diffs — but cannot transmit a complete shard under the strongest tested compressor**, granting the adversary all shared side information (known vocabulary ordering, the reference corpus, common codebooks, custom arithmetic coders) and summing across all rounds. The ~3× nominal separation between key information and compressed shard size makes this interval plausible but not assured; testing it is the first go/no-go check in Phase 0, before any container infrastructure exists.

If no usable interval exists, tuning the number cannot fix the mechanic — the information geometry must change. The first lever works in the design's favor: shard entropy grows linearly in token count while key information grows roughly as V·log V with vocabulary V growing sublinearly in text length (Heaps' law), so longer novels widen the interval mechanically. Further levers: vocabulary-restrained texts, larger shards, or a smaller required shared state.

Once separation holds, the budget's deeper function is to force **selection**. The genuinely valuable payload is neither a dictionary dump nor raw text but prioritized evidence — a full bigram count matrix over 8k types is larger than the text itself — so the calibration target is that relaying raw text be strictly dominated by relaying compressed belief, and that transmitting everything an agent knows be infeasible, leaving partial, prioritized updates as the only viable strategy.

**Budget laundering via reconstructions** is prevented by the private output channel. **Grader gaming** — ImpossibleBench (arXiv:2510.20270) documents frontier models exploiting evaluation surfaces at high rates when a shortcut exists — motivates explicit red-teaming of the scorer and the solver-reproducibility requirement rather than assuming honest play.

**Switch-detection gaming.** Chapter boundaries are structurally visible, so an agent can flag every boundary and score well under a tolerance-window metric. We use event-level precision and recall with penalties for premature alarms, and either hides *S* or requires exactly *S* predictions.

**Summary threat model.**


| Attack                            | Design response                                                                                     | Residual risk                                                                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Compressed shard relay            | Adversarial compressor suite in Phase 0; canonical channel; budget set below tested relay threshold | Capacity margin may prove too thin, forcing geometry redesign                                    |
| Repository metadata side channels | Server-normalized single message object per turn                                                    | Timing and infrastructure channels still need audit                                              |
| Static-evidence latency artifact  | Chronological progressive reveal                                                                    | Reveal schedule creates role asymmetry (held constant across arms)                               |
| Collaboration-score confounding   | Matched comm vs. no-comm three-agent comparison, paired repetitions                                 | Agent stochasticity; calibration-scale runs, not publication statistics                          |
| Unobservable re-keyed entries     | Active-on-both-sides sampling with matched controls                                                 | Recoverability remains frequency-dependent                                                       |
| Statistical solver saturation     | Baseline ladder gated before infrastructure                                                         | Residual headroom is not uniquely semantic                                                       |
| Source recognition                | Entity regeneration, structural dedup, cipher-view canary                                           | Recognition cannot be absolutely excluded; standard is that identification not dominate strategy |
| Grader gaming                     | Solver re-execution in clean environment; scorer red-teaming                                        | New exploit surfaces appear with each added mechanic                                             |


---



## Scoring

Reconstruction quality is the primary score, and everything else is diagnostic. 

**Reconstruction quality.** Token accuracy and macro type accuracy against ground truth, reported by frequency decile and broken out for function words, content words, and named entities separately. Capped, smoothed IDF-weighted accuracy is retained as a *secondary* metric only — uncapped −log p explodes on OOV types and over-rewards the tail.

**Named entities** get both a strict score and an **entity-permutation-invariant** score. Consistently swapping two same-gender character names can leave a novel perfectly coherent, meaning the ciphertext establishes narrative roles without determining which arbitrary label attaches to which role. The invariant score is computed deterministically by optimal assignment between recovered entity roles and ground-truth names. Proper-noun regeneration reduces but does not eliminate this symmetry.

**Dictionary recovery**, scored per regime and **restricted to types active in that regime**, with changed and unchanged entries reported separately. This split is the belief-revision instrument: unchanged-entry accuracy after a switch measures failed stay; changed-entry accuracy measures failed update; false retractions of unchanged mappings are counted directly.

**Switch detection** by event-level precision and recall with premature-alarm penalties. Detection latency is rounds from the oracle-defined release of sufficiently contradictory text to the first correct anomaly or regime-fork commit; adaptation latency runs from detection until changed-entry accuracy crosses a preset threshold. The headline revision plot shows four trajectories per switch: changed-entry accuracy, unchanged-entry accuracy, false retractions of stable entries, and recovery of newly changed ones — failed stay and failed update, operationalized without pretending to a general belief-revision benchmark.

**Collaboration**, measured by a matched ablation. The primary comparison is **communication-enabled three-agent versus communication-disabled three-agent**, identical in shard assignment, reveal schedule, model-call and token allowance, local compute, turn order, and seeds, over paired repetitions — enough that one lucky team run cannot carry the conclusion, at calibration scale rather than publication-grade confidence intervals. Deterministic grading does not make the treatment effect deterministic. We employ a secondary concept called **team scale-up gain**: it bundles extra compute, distributed observation, ensembling, and communication, and is reported as exactly that bundle. For the public artifact, one compelling run can still be the showpiece; the paired ablation is the engineering evidence behind it.

**Calibration** (optional) by Brier score over per-entry confidences.

Because no exact attainable ceiling is computable, scores are reported raw and against the best ladder rung, with a small expert-human or human-plus-tools baseline in Phase 0 to establish an empirical reference.

Alongside the numbers, the commit history ships as a first-class artifact: the epistemic cascade — observation, interpretation, commit, pull, revision — timestamped at every step, with stale consensus, confident errors becoming committed truth, and anchoring on prior-regime mappings all directly inspectable.

---



## Scope: Puzzle, Not Benchmark

This document declines one class of criticism deliberately, and should say so rather than absorb it silently.

Palimpsest is a puzzle. It is one compound task with a deterministic grader, a continuous credit gradient, and an inspectable solving trace. It is not a construct-validated instrument, and it does not claim to isolate a single capability. Reviewed against a benchmark-paper standard it will always show poor construct validity, because a compound task confounds decipherment, change detection, revision, coordination, and engineering by design — that confounding is what makes it a puzzle rather than a psychometric.

One relevant comparison is GBAEval, which under the same standard has no ablation matrix, no construct-validity analysis, no confidence intervals, and no human calibration panel, and which explicitly declines to present itself as a complete measure of software-engineering ability. Palimpsest adopts the same limitation language, with one asymmetry conceded rather than contested: GBAEval's oracle directly measures the artifact it names, while Palimpsest's oracle directly measures restored text and recovered mappings — not semantic reasoning, collaboration, or belief revision as traits. Those appear throughout this document as intended demands, observable behaviors, and diagnostics, validated as load-bearing by the small set of matched comparisons in the Phase 0 gate and Phase 4 — never as separately certified measurements. Those comparisons exist because a few are needed to interpret the score at all, not as a claim to have decomposed the construct.

If the project later warrants a public evaluation rather than a puzzle, the correct positioning is a family of controlled nonstationary decipherment environments under matched ablations. That is a larger, different, and more expensive project.

---



## Implementation Plan

**Nothing is built until the cipher is shown to have the desired score profile**, because the entire project is worthless if strong statistical attack closes the gap, and that question is answerable with no harness at all.

**Phase 0 — Feasibility gate. Four checks, all hard.** Several 10–30k-token texts; no container infrastructure, no polished grading.

*A. Channel separation.* Pure information engineering, no agents. Compute the best achievable compression of a complete or sparse recovered dictionary and of a shard — under token-ID coding, coding conditioned on shared vocabulary and reference corpus, and custom codebooks — cumulatively across all rounds. Verify a usable budget interval exists between useful belief state and complete shard relay. If not, widen the information geometry (text length first, per Heaps' law) before anything else is built.

*B. Decipherment headroom.* Stationary single key, one agent. Run the compact ladder, then one frontier agent with tools and one human-plus-tools solver. Verify no saturation by mechanical methods, progressive improvement, and difficulty concentrated where designed. Run identification attacks including the cipher-view canary; test proper-noun regeneration quality and at least one non-Gutenberg source.

*C. Revision dynamics.* One partial re-key, real chronological reveal, single agent. Verify the intended signal exists: early mappings become accurate, changed mappings deteriorate after the switch, unchanged mappings persist, and a competent solver can selectively recover rather than restart.

*D. Communication value.* The smallest paired comparison — three agents with and without a budgeted channel, identical instances and compute, a minimal file-based harness standing in for the canonical channel. Verify communication changes outcomes or produces a materially richer solving trace.

**Pass all four, or change the design before infrastructure hardens the wrong one.**

**Phase 1 — Corpus and generator.** Gutenberg mirror and metadata filter; boilerplate stripping; normalization and tokenization; MinHash/LSH dedup plus structural-fingerprint dedup against every candidate; NER-based proper-noun regeneration; seeded derangement with optional POS-preserving mode; switch selection over types active in adjacent segments with matched controls; shard boundaries placed for the cross-shard ambiguity case; manifest keyed to one seed.

**Phase 2 — Harness.** Per-agent containers, network namespace exposing only the repository. Canonical message object with server-side normalization and cumulative byte ledger. Round scheduler with progressive chapter reveal, rotated commit order, final synchronized pull-only phase, and per-turn wall-clock and token caps. Explicit compute-boundary specification and logging: total input and output tokens, model invocation count, CPU time, memory, context-truncation policy, file-read limits, whether subagents are permitted, and the exact scaffold — an agent's work is bounded by inference budget and persistent workspace, not by one context window, and unlogged this is uninterpretable.

**Phase 3 — Grader and replay.** All scorers; solver re-execution for reproducibility; replay from seed, commit log, and private outputs; automatic per-round trajectory plots for changed and unchanged entries.

**Phase 4 — Matched calibration runs.** The minimum set needed to interpret a score, at calibration scale: stationary versus changing key; the comm/no-comm treatment from gate D, now paired and repeated; oracle segmentation versus hidden switches; one centralized agent with all shards (the pooling upper bound). A handful of books, seeds, rotated agent positions, and paired repetitions; matched mean differences, honestly labeled as calibration rather than publication statistics.

**Phase 5 — Red team and calibration.** Budget sweep against the strongest available conditional compressor. Channel side-channel audit. Identification attacks at full scale. Grader gaming. Degenerate strategies.

---



## Difficulty Dials

Parameters, not authored content: 

1. text length (the primary lever on channel-interval width, via Heaps' law)
2. substitution scope (content words only versus everything including function words, which hides syntax itself)
3. POS-preserving versus unrestricted permutation
4. rotation fraction and changed-entry token mass
5. number of switches and minimum segment length
6. reveal granularity
7. hard and agent count
8. byte budget
9. round count
10. reference-corpus size
11. boundary revealed versus hidden
12. Brier calibration scoring on or off

---



## Open Decisions and Risks

**Text corpus — three tiers, decided, revisitable.** Tier 1 (default): the Gutenberg long tail with proper-noun regeneration, structural dedup, and cipher-view canary screening — this preserves the no-manual-authoring property and the "corpus is the key" structure. Tier 2 (preferred hardening): recently *digitized* public-domain works — texts always in the public domain whose first digital transcription postdates the evaluated model's training window, so there was nothing to train on. Recency of digitization rather than authorship buys most of the contamination benefit of fresh text with zero licensing exposure and no register mismatch against the public-domain reference corpus (a mismatch that would degrade alignment rungs for reasons unrelated to the capability under test — the trap in otherwise-appealing recent corpora such as contemporary web fiction). Tier 3 (fallback): fresh private text, generated post-cutoff or licensed unpublished prose — scientifically safest, but it surrenders both properties Tier 1 preserves. Trigger for demoting Tier 1: identification attacks succeeding above a low threshold after regeneration, or plot-level recall measurably lifting scores in Phase 0.

**Ablation scope — decided, revisitable.** Four core conditions (gate D plus Phase 4); the full factorial, human panels, and a transfer instance testing solver generalization are roadmap. A transfer instance is scientifically stronger but converts the puzzle into a task family, which is the trade this project declines for now.

**NER quality risk.** Proper-noun regeneration on 19th-century prose will make errors — missed entities, mangled titles, over-capture of common nouns. Since regeneration now carries three defensive jobs, its failure modes need explicit measurement in Phase 0, not assumption.

**Budget calibration** remains genuinely empirical with failure modes on both sides, now against a corrected target — selection pressure above a verified separation interval, not a bare relay barrier — and promoted to the first check in the Phase 0 gate.

**Determinism, claimed precisely.** Grading replays deterministically from artifacts; agents are stochastic even at temperature zero. This is GBAEval's shape and no more.

**Citation hygiene.** A conformity-cascade claim from v1 has been removed pending a verifiable source. All arXiv identifiers below should be re-verified before this document goes external; several are recent and were reported second-hand during research.

**Prior art.** Substitution ciphers appear in the LLM literature, and decipherment is a classic NLP line. The novelty claim should be stated precisely: word-level substitution at book scale, with distributed evidence, an information-limited channel, and hidden partial re-keying, graded by a stack that measures selective revision and coordination separately.

---



## References

Mechanize, Inc. "Introducing GBA Eval." Technical blog, 2026.

"Contextual Belief Management in Large Language Models." arXiv:2605.30219. *(Primary theoretical anchor: failed-stay / failed-update.)*

Wei et al. "CodeARC: Benchmarking Reasoning Capabilities of LLM Agents for Inductive Program Synthesis." arXiv:2503.23145. *(Grading-structure analogy only.)*

Sinha et al. "The Illusion of Diminishing Returns: Measuring Long Horizon Execution in LLMs." arXiv:2509.09677.

Kwa et al. (METR). "Measuring AI Ability to Complete Long Tasks." arXiv:2503.14499.

Cemri et al. "Why Do Multi-Agent LLM Systems Fail?" (MAST), v3. arXiv:2503.13657.

Chen et al. "Premise Order Matters in Reasoning with Large Language Models." arXiv:2402.08939.

Zhong et al. "ImpossibleBench: Measuring Reward Hacking in Coding Agents." arXiv:2510.20270.

Wei et al. "SATBench: Benchmarking LLM Logical Reasoning via Satisfiability Puzzles." arXiv:2505.14615.

"Localizing Anchoring Pathways in Language Models." arXiv:2606.12818. *(Adjacent; not direct evidence for partial-key revision.)*

Chollet et al. "ARC-AGI-2." arXiv:2505.11831. *(Broad motivation.)*

Ravi and Knight. "Deciphering Foreign Language." ACL 2011.

Knight et al. "Unsupervised Analysis for Decipherment Problems." ACL 2006.

Conneau et al. "Word Translation Without Parallel Data." arXiv:1710.04087.

Artetxe, Labaka, and Agirre. "A Robust Self-Learning Method for Fully Unsupervised Cross-Lingual Mappings of Word Embeddings." ACL 2018.

Gale and Church. "A Program for Aligning Sentences in Bilingual Corpora." Computational Linguistics, 1993.