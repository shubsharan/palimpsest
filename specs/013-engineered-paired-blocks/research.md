# Research: Engineered Paired Puzzle Blocks

## Decision: Treat paragraphs as the atomic evidence unit

**Rationale**: Current character-count slicing cuts prose mid-paragraph and makes evidence geometry an artifact of source length. Paragraph units preserve natural context, make union coverage explicit, and avoid source-specific chapter parsing for Roman headings and XHTML.

**Alternatives considered**:

- Sentence allocation was rejected because it fragments context and creates a much larger search surface.
- Chapter allocation was rejected because five sources use inconsistent heading markup and chapters are too coarse for 18 balanced buckets.
- Repairing contiguous slices was rejected because it cannot create owner-weighted evidence and universal sentinels deliberately.

## Decision: Use checked-in bytes and a standard-library HTML parser

**Rationale**: Four Project Gutenberg targets use the exact UTF-8 files at `https://www.gutenberg.org/cache/epub/133/pg133.txt`, `https://www.gutenberg.org/cache/epub/4313/pg4313.txt`, `https://www.gutenberg.org/cache/epub/11052/pg11052.txt`, and `https://www.gutenberg.org/cache/epub/482/pg482.txt`; Pointed Firs uses the requested XHTML at `https://www.gutenberg.org/files/367/367-h/367-h.htm`. A small `HTMLParser` subclass canonicalizes `<p>` text without adding a scraping stack. Provenance pins URL, length, digest, media type, and retrieval date before construction.

**Alternatives considered**:

- Downloading during a build was rejected because build identity would depend on external state.
- Beautiful Soup or browser parsing was rejected because the required markup is simple and no new dependency is needed.
- Source-specific chapter regexes were rejected because deterministic paragraph windows solve the actual puzzle-design need.

## Decision: First-feasible bounded seeded search

**Rationale**: The scientific choice is reproducible only if search order, caps, scores, tie-breaking, and fallback are explicit. A bounded hill-climb is sufficient for five local blocks and easier to inspect than a general optimizer.

**Alternatives considered**:

- Integer programming was rejected as a new dependency and unnecessary exactness.
- Unbounded simulated annealing was rejected because runtime and first-feasible identity would be harder to audit.
- A single greedy pass was rejected because it has no principled tier fallback and can strand rare specialist evidence.

## Decision: Freeze three simple tiers

**Rationale**: The tiers trade balance and information geometry without silently weakening constraints. Strict is preferred; balanced and fallback preserve the same qualitative manipulation with wider numerical bounds. Every rejection is recorded.

**Alternatives considered**:

- Per-book hand tuning was rejected because it confounds block identity with discretionary calibration.
- Silent clamping was rejected because it hides infeasibility.
- One universal threshold was rejected because naturally different prose distributions can fail for reasons unrelated to the intended puzzle.

## Decision: Select oracle sets after allocation, then verify the manipulation

**Rationale**: Sentinels and specialists are properties of actual exposure, so allocation must precede their selection. Stable controls are selected from the remaining vocabulary by deterministic nearest matching. The builder validates the achieved old-key loss rather than assuming a word-set label guarantees it.

**Alternatives considered**:

- Selecting changed types globally before allocation was rejected because it cannot guarantee per-agent exposure.
- Random controls were rejected because frequency and context differences would confound the manipulation.
- Exposing labels to agents was rejected because it behaviorally prescribes what to notice.

## Decision: Build twins together

**Rationale**: A single paired build makes the shared window, allocation, and base key structural invariants. It is simpler and safer than trying to compare two independently built directories after the fact.

**Alternatives considered**:

- Independent stationary and re-key builds were rejected because pre-boundary identity would be a convention rather than an enforced contract.
- Re-keying at runtime was rejected because key selection and oracle verification belong to trusted deterministic construction.

## Decision: Remove timing from build identity

**Rationale**: Feature 014 needs explicit non-uniform offsets while using identical stage bytes across communication-paired conditions. Ordered immutable stages are puzzle construction; release timing is runtime protocol.

**Alternatives considered**:

- Keeping `stageIntervalMs` and deriving the future schedule was rejected because `[0,5,10,20,30,40]` minutes is not arithmetic.
- Rebuilding blocks for different schedules was rejected because timing would unnecessarily change the scientific puzzle identity.

## Feasibility Evidence

A provider-free probe over the exact five linked targets found enough prose for the declared window envelope. Simple balanced paragraph assignment produced dozens of word types recurring before and after the boundary for all three agents and multiple owner-weighted candidates per agent on every target. Feature acceptance still depends on the committed builder reproducing the first feasible windows and passing the frozen tiers; the probe is not itself a committed scientific result.

## No Remaining Clarifications

The feature description fixes geometry, targets, pairing, provenance, optimizer order, oracle secrecy, and required checks. Numeric tier bounds and search caps are resolved in the plan and contract.
