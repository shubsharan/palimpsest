# Manuscript minimap — design

**Date:** 2026-08-06
**Branch:** feature/023-viewer-perf-refactor
**Status:** Approved for implementation

## Problem

While the cipher is being solved, the reconstruction text in `ManuscriptPane`
can be long. A user can only see the portion currently scrolled into view, so
the overall progress of the decode — which regions are solved, freshly revealed,
or regressed — is invisible without scrolling the whole document.

## Goal

Add a VS Code–style **minimap** to the manuscript panel: a scaled-down rendering
of the entire reconstruction where each word is a tiny colored mark, preserving
the paragraph/word shape of the text and colored by its decode state. Users see
full-text decode progress at a glance and can jump to any region by clicking.

Non-goals: keyboard navigation of the map (the existing `ms-jump` buttons already
cover keyboard jumping), search/filtering, and any change to decode contracts,
the SSE stream, or the server.

## Approved decisions

- **Placement:** right-side vertical strip, same vertical order as the manuscript.
- **Interaction:** click-to-jump plus a viewport marker that tracks the scroll
  position (like a real editor minimap).
- **Fidelity:** per-word marks with real line breaks — each word is one mark sized
  to its length; rows wrap and break at source newlines to mirror the text shape.
- **Rendering:** Canvas 2D (single `<canvas>`, redraw on change). Chosen over SVG
  / DOM spans because a manuscript can contain thousands of words, and a per-word
  DOM/SVG node count would regress performance on the `viewer-perf-refactor` branch.

## Existing building blocks (reused, not rebuilt)

- `tokenizeLines(ciphertext)` (`replay-index.ts`) already splits ciphertext into
  lines of word/plain spans, each word carrying a running `wordIndex`.
- `DecodeSnapshot.states: Uint8Array` — one state code per word (0 unchanged,
  1 newly-correct, 2 previously-correct, 3 regressed, 4 changed-incorrect), and
  `DecodeSnapshot.candidates` — the decoded candidate per word (or `undefined`).
- The manuscript pane already computes `ciphered = candidate === undefined &&
  state === "unchanged"`; the map reuses the same rule so colors match the text.

## Architecture

### Components

- **`ManuscriptMap.tsx`** (new, memoized). Props:
  - `ciphertext: string`
  - `snapshot: DecodeSnapshot | undefined`
  - `scrollRef: RefObject<HTMLDivElement>` — the `.decoded-paper` scroll container.
  - `wordsLabel: string` — human summary for the aria-label (e.g. the pane's
    "128 / 540 words recovered" string), so the map need not recompute it.

  Renders a container (`.manuscript-map`, `role="img"`, `aria-label`) holding a
  `<canvas>` and one absolutely-positioned `.map-viewport` overlay box.

- **`ManuscriptPane.tsx`** (modified). Owns a `scrollRef` (`useRef<HTMLDivElement>`).
  Its third grid row becomes a flex row `.manuscript-body` containing the existing
  `DecodedPaper` (given `scrollRef` on its scroll element, flex:1) and
  `<ManuscriptMap>` (fixed-width column). `DecodedPaper` accepts and forwards the
  ref to its `.decoded-paper` root; the `is-raw` (no-snapshot) branch also gets it.

### Pure helpers (in `replay-index.ts`, unit-tested)

- **`buildMapLayout(ciphertext): MapLayout`** — memoized on ciphertext in the
  component. Returns `{ lines: { words: { wordIndex, length }[] }[], wordCount }`.
  Built from `tokenizeLines`, keeping only word spans; every source line yields a
  `lines` entry (including empty lines, so blank-line spacing shows as short rows).

- **`stateColor(stateCode, hasCandidate): string`** — pure mapping from a decode
  state code (+ whether the word has a candidate) to a CSS color string drawn on
  the canvas. Mirrors the manuscript palette:
  - ciphered (`unchanged` & no candidate) → faint ink (low alpha)
  - `newly-correct` → `--fresh` green
  - `previously-correct`, or `unchanged` with a candidate → `--ink`
  - `regressed` → `--regress` red
  - `changed-incorrect` → `--amber`

  Color literals live in one small palette constant so canvas and CSS stay aligned;
  a code comment ties them to the `--fresh/--regress/--amber/--ink` variables.

### Drawing

On mount, snapshot change, and container resize (`ResizeObserver`), redraw inside
a single `requestAnimationFrame` (coalesce bursts of snapshot updates into one
paint):

1. Size the canvas backing store to the container's client box × `devicePixelRatio`.
2. Compute row height so **all** rows fit the available height (no internal scroll):
   lay words left-to-right within the column width, wrap when a row fills, and
   force a new row at each source-line boundary; total rows `R` set
   `rowHeight = availableHeight / R`. Mark width ∝ word length (min 1px), with a
   small gap; clamp mark height ≤ rowHeight.
3. For each word, fill its rect with `stateColor(states[wordIndex], candidate)`.
   No snapshot → every mark is faint ink (a ciphertext-shape preview).

### Interaction

- **Viewport marker.** Subscribe to the scroll container's `scroll` event
  (rAF-throttled). Set the overlay box `top = scrollTop / scrollHeight · H` and
  `height = max(minPx, clientHeight / scrollHeight · H)`, where `H` is the map's
  pixel height. When content fits without scrolling (`scrollHeight ≈ clientHeight`)
  the box covers the whole map.
- **Click / drag to jump.** On pointer-down (and pointer-move while held) at offset
  `y`, set `scrollRef.scrollTop = clamp((y / H) · scrollHeight, 0, scrollHeight −
  clientHeight)`. Same fractional model as the viewport marker, so clicking on the
  box leaves it in place and clicking elsewhere moves it there.

Both the marker update and the redraw are rAF-throttled; the map never blocks the
playhead or scroll.

## Edge cases

- **No snapshot / raw ciphertext:** faint preview of the full text shape.
- **Failed / empty checkpoint:** `DecodeSnapshot` already carries forward the prior
  `states`/`candidates`, so the map simply keeps the last colors — no special path.
- **Empty ciphertext / zero words:** render nothing (blank column); no divide-by-zero
  (guard `R` and `wordCount`).
- **Very long lines:** wrap within the column; row count grows and `rowHeight`
  shrinks to keep everything on screen.
- **Mobile / narrow layout:** hidden below the existing `.manuscript` mobile
  breakpoint — the strip needs horizontal room and the mobile panel is single-column.

## Accessibility

Canvas content is decorative; the `.manuscript-map` container carries `role="img"`
and an `aria-label` summarizing progress (built from `wordsLabel`). Keyboard-driven
jumping remains served by the existing `ms-jump` buttons.

## Testing

Vitest, alongside `replay-index.test.ts`:

- `buildMapLayout()` — correct line count (including blank lines), word grouping,
  `wordIndex` continuity across lines, and `wordCount`.
- `stateColor()` — each state code maps to the expected color, and the
  ciphered-vs-`--ink` distinction keys off `hasCandidate`.

Canvas rasterization is not unit-tested (jsdom stubs the 2D context); the pure
layout and color logic that determine correctness are covered above.

## Scope summary

- New: `ManuscriptMap.tsx`; `buildMapLayout` + `stateColor` helpers + their tests.
- Modified: `ManuscriptPane.tsx` (scrollRef lift, flex body, render the map);
  `DecodedPaper` ref forwarding; a `.manuscript-body` / `.manuscript-map` /
  `.map-viewport` CSS block plus a mobile-hide rule.
- Unchanged: viewer contracts, decode SSE stream, server, and all run/grading code.
