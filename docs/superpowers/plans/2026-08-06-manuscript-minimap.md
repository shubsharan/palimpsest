# Manuscript Minimap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code–style minimap to the manuscript panel — a right-side vertical strip that renders every ciphertext word as a tiny colored mark (colored by decode state), with a viewport marker and click-to-jump, so decode progress is visible at a glance without scrolling.

**Architecture:** Two pure, unit-tested helpers in `replay-index.ts` (`buildMapLayout` to turn ciphertext into a line/word structure, `stateColor` to map a decode state to a canvas color) feed a new memoized `ManuscriptMap` React component. The component draws all words onto a single `<canvas>` (sized to fit the whole text with no internal scroll), overlays a `.map-viewport` box driven by the manuscript's scroll position, and translates clicks/drags into scroll offsets. `ManuscriptPane` lifts a `scrollRef` to the `.decoded-paper` element and lays the paper + map out side by side.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), React 18 (`memo`, hooks), Canvas 2D, Vitest (`unit` project, node env), Vite (`viewer:build`), oxlint/oxfmt.

## Global Constraints

- TypeScript is strict with `noUncheckedIndexedAccess` — every indexed array/`Uint8Array` access is possibly `undefined`; guard or assert (`arr[i]!`) exactly as the surrounding code does.
- No new runtime dependencies. Canvas + DOM only.
- Do not change viewer contracts (`src/viewer/contracts.ts`), the decode SSE stream, or the server.
- Reuse existing helpers — `tokenizeLines`, `countCiphertextWords`, `STATE_CODES` — do not re-derive word tokenization or state codes.
- Canvas colors must mirror the manuscript ink palette in `styles.css`: `--fresh #2f6d3a`, `--ink #20211c`, `--regress #a5453a`, `--amber #b98a2e`.
- Lint runs with `--deny-warnings`; unused vars / floating promises fail the build.
- ES module imports use `.js` extensions on relative paths (e.g. `../replay-index.js`), matching the codebase.

---

### Task 1: Pure minimap helpers (`buildMapLayout`, `stateColor`)

**Files:**
- Modify: `src/viewer/ui/replay-index.ts` (append new exports near the other decode helpers)
- Test: `src/viewer/ui/replay-index.test.ts` (add cases)

**Interfaces:**
- Consumes (already in `replay-index.ts`): `tokenizeLines(value: string): TextLine[]`, `countCiphertextWords(ciphertext: string): number`, the module-private `STATE_CODES: Record<DecodeWordState, number>`, and `TextSpan` (`{ surface: string; wordIndex?: number }`).
- Produces (used by Task 2):
  - `interface MapWord { wordIndex: number; length: number }`
  - `interface MapLine { words: readonly MapWord[] }`
  - `interface MapLayout { lines: readonly MapLine[]; wordCount: number }`
  - `function buildMapLayout(ciphertext: string): MapLayout`
  - `const MAP_COLORS` — `{ ciphered, fresh, ink, regress, amber }` of color strings
  - `function stateColor(state: number, hasCandidate: boolean): string`

- [ ] **Step 1: Write the failing tests**

Add these imports to the existing import block in `src/viewer/ui/replay-index.test.ts` (merge into the current named-import list):

```ts
import {
  MAP_COLORS,
  buildMapLayout,
  stateColor,
} from "./replay-index.js";
```

Append to `src/viewer/ui/replay-index.test.ts`:

```ts
describe("buildMapLayout", () => {
  it("groups words per source line with a continuous wordIndex", () => {
    const layout = buildMapLayout("the sea\nrose high");
    expect(layout.wordCount).toBe(4);
    expect(layout.lines).toHaveLength(2);
    expect(layout.lines[0]!.words).toEqual([
      { wordIndex: 0, length: 3 },
      { wordIndex: 1, length: 3 },
    ]);
    expect(layout.lines[1]!.words).toEqual([
      { wordIndex: 2, length: 4 },
      { wordIndex: 3, length: 4 },
    ]);
  });

  it("keeps a blank line as an empty row so paragraph spacing shows", () => {
    const layout = buildMapLayout("a\n\nb");
    expect(layout.lines).toHaveLength(3);
    expect(layout.lines[1]!.words).toEqual([]);
    expect(layout.wordCount).toBe(2);
  });

  it("returns no words for empty ciphertext", () => {
    const layout = buildMapLayout("");
    expect(layout.wordCount).toBe(0);
    expect(layout.lines).toHaveLength(1);
    expect(layout.lines[0]!.words).toEqual([]);
  });
});

describe("stateColor", () => {
  it("maps decode states to the manuscript palette", () => {
    expect(stateColor(1, true)).toBe(MAP_COLORS.fresh); // newly-correct
    expect(stateColor(2, true)).toBe(MAP_COLORS.ink); // previously-correct
    expect(stateColor(3, true)).toBe(MAP_COLORS.regress); // regressed
    expect(stateColor(4, true)).toBe(MAP_COLORS.amber); // changed-incorrect
  });

  it("distinguishes ciphered from resolved for unchanged words", () => {
    expect(stateColor(0, false)).toBe(MAP_COLORS.ciphered);
    expect(stateColor(0, true)).toBe(MAP_COLORS.ink);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/viewer/ui/replay-index.test.ts --project unit`
Expected: FAIL — `buildMapLayout`, `stateColor`, `MAP_COLORS` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/viewer/ui/replay-index.ts` (after `decodeStateName`, before `emptyCandidates` is fine — anywhere at module scope; `STATE_CODES` is already declared above):

```ts
export interface MapWord {
  wordIndex: number;
  length: number;
}

export interface MapLine {
  words: readonly MapWord[];
}

export interface MapLayout {
  lines: readonly MapLine[];
  wordCount: number;
}

// One row per source line (blank lines included, so paragraph gaps survive) with
// each word's running index and character length — enough to lay the whole text
// out in the minimap without re-tokenizing.
export function buildMapLayout(ciphertext: string): MapLayout {
  const lines = tokenizeLines(ciphertext).map((line) => ({
    words: line.spans.flatMap((span) =>
      span.wordIndex === undefined
        ? []
        : [{ wordIndex: span.wordIndex, length: span.surface.length }],
    ),
  }));
  return { lines, wordCount: countCiphertextWords(ciphertext) };
}

// Canvas mirror of the manuscript ink palette (styles.css --fresh/--ink/--regress
// /--amber). Kept here so the minimap and the rendered text stay in visual sync.
export const MAP_COLORS = {
  ciphered: "rgba(32, 33, 28, 0.22)",
  fresh: "#2f6d3a",
  ink: "#20211c",
  regress: "#a5453a",
  amber: "#b98a2e",
} as const;

export function stateColor(state: number, hasCandidate: boolean): string {
  switch (state) {
    case STATE_CODES["newly-correct"]:
      return MAP_COLORS.fresh;
    case STATE_CODES.regressed:
      return MAP_COLORS.regress;
    case STATE_CODES["changed-incorrect"]:
      return MAP_COLORS.amber;
    case STATE_CODES["previously-correct"]:
      return MAP_COLORS.ink;
    default:
      // unchanged: resolved-to-same reads as ink, still-ciphered reads faint.
      return hasCandidate ? MAP_COLORS.ink : MAP_COLORS.ciphered;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/viewer/ui/replay-index.test.ts --project unit`
Expected: PASS (all new cases green, existing cases still green).

- [ ] **Step 5: Typecheck and lint the touched files**

Run: `pnpm typecheck && pnpm exec oxlint --deny-warnings src/viewer/ui/replay-index.ts src/viewer/ui/replay-index.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/viewer/ui/replay-index.ts src/viewer/ui/replay-index.test.ts
git commit -m "feat(viewer): add minimap layout and state-color helpers"
```

---

### Task 2: `ManuscriptMap` component, wiring, and styles

**Files:**
- Create: `src/viewer/ui/components/ManuscriptMap.tsx`
- Modify: `src/viewer/ui/components/ManuscriptPane.tsx` (lift `scrollRef`, forward it to `DecodedPaper`, wrap paper + map in `.manuscript-body`)
- Modify: `src/viewer/ui/styles.css` (add `.manuscript-body`, `.manuscript-map`, `.map-viewport`, and a mobile-hide rule)

**Interfaces:**
- Consumes (from Task 1): `buildMapLayout`, `stateColor`, `MapLayout`, and (existing) `DecodeSnapshot` from `../replay-index.js`.
- Produces: `function ManuscriptMap(props: { ciphertext: string; snapshot: DecodeSnapshot | undefined; scrollRef: RefObject<HTMLDivElement | null>; wordsLabel: string }): JSX.Element`.

This task has no unit test — canvas rasterization is not exercisable under jsdom. Its deliverable is verified by typecheck, viewer build, lint, and a manual dev-server check (steps 5–6). The component and its wiring are one reviewable unit: neither is useful without the other.

- [ ] **Step 1: Create the component**

Create `src/viewer/ui/components/ManuscriptMap.tsx`:

```tsx
import { memo, useEffect, useMemo, useRef, type RefObject } from "react";

import { buildMapLayout, stateColor, type DecodeSnapshot } from "../replay-index.js";

// A word occupies max(1, length) character-cells; GAP_CELLS separates words.
const GAP_CELLS = 1;
// Ideal painted row height (px). Rows shrink below this only when the whole text
// would otherwise overflow the column.
const TARGET_ROW_H = 4;
const MIN_ROW_H = 1.5;
const BASE_CELL_W = 2.2;

interface PlacedWord {
  wordIndex: number;
  startCell: number;
  cells: number;
}

// Flow words into rows `cols` character-cells wide. Every source line starts a
// fresh row (so blank lines become empty rows / paragraph spacing).
function flowRows(
  lines: ReturnType<typeof buildMapLayout>["lines"],
  cols: number,
): PlacedWord[][] {
  const rows: PlacedWord[][] = [];
  for (const line of lines) {
    let row: PlacedWord[] = [];
    let col = 0;
    for (const word of line.words) {
      const cells = Math.max(1, word.length);
      if (col > 0 && col + cells > cols) {
        rows.push(row);
        row = [];
        col = 0;
      }
      row.push({ wordIndex: word.wordIndex, startCell: col, cells });
      col += cells + GAP_CELLS;
    }
    rows.push(row);
  }
  return rows;
}

export const ManuscriptMap = memo(function ManuscriptMap({
  ciphertext,
  snapshot,
  scrollRef,
  wordsLabel,
}: {
  ciphertext: string;
  snapshot: DecodeSnapshot | undefined;
  scrollRef: RefObject<HTMLDivElement | null>;
  wordsLabel: string;
}) {
  const layout = useMemo(() => buildMapLayout(ciphertext), [ciphertext]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);

  // Paint every word onto the canvas, sized so the entire text fits the column.
  useEffect(() => {
    const draw = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (container === null || canvas === null) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Shrink the cell width until the flowed rows fit the height at a usable
      // row height (fewer columns => fewer wraps => fewer rows).
      let cellW = BASE_CELL_W;
      let rows = flowRows(layout.lines, Math.max(1, Math.floor(width / cellW)));
      let rowH = Math.min(TARGET_ROW_H, height / rows.length);
      for (let attempt = 0; attempt < 8 && rowH < MIN_ROW_H && cellW > 0.6; attempt += 1) {
        cellW *= 0.8;
        rows = flowRows(layout.lines, Math.max(1, Math.floor(width / cellW)));
        rowH = Math.min(TARGET_ROW_H, height / rows.length);
      }
      const barH = Math.max(1, rowH - 1);
      const states = snapshot?.states;
      const candidates = snapshot?.candidates;

      for (let r = 0; r < rows.length; r += 1) {
        const y = r * rowH;
        for (const word of rows[r]!) {
          const state = states?.[word.wordIndex] ?? 0;
          const hasCandidate =
            candidates !== undefined && candidates[word.wordIndex] != null;
          ctx.fillStyle = stateColor(state, hasCandidate);
          const x = word.startCell * cellW;
          ctx.fillRect(x, y, Math.max(1, word.cells * cellW - 1), barH);
        }
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(draw);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    if (containerRef.current !== null) observer.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [layout, snapshot]);

  // Track the manuscript's scroll position with the viewport box, and translate
  // pointer position on the map back into a scroll offset (same fractional model).
  useEffect(() => {
    const scroller = scrollRef.current;
    const container = containerRef.current;
    const box = viewportRef.current;
    if (scroller === null || container === null || box === null) return;

    let syncFrame = 0;
    const sync = () => {
      const total = scroller.scrollHeight;
      const visible = scroller.clientHeight;
      const mapH = container.clientHeight;
      if (total <= 0) return;
      const top = (scroller.scrollTop / total) * mapH;
      const boxH = Math.max(10, (visible / total) * mapH);
      box.style.top = `${String(top)}px`;
      box.style.height = `${String(boxH)}px`;
    };
    const scheduleSync = () => {
      cancelAnimationFrame(syncFrame);
      syncFrame = requestAnimationFrame(sync);
    };

    const scrollToFraction = (clientY: number) => {
      const rect = container.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      scroller.scrollTop = fraction * (scroller.scrollHeight - scroller.clientHeight);
    };
    const onPointerDown = (event: PointerEvent) => {
      container.setPointerCapture(event.pointerId);
      scrollToFraction(event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 0) return;
      scrollToFraction(event.clientY);
    };

    scheduleSync();
    scroller.addEventListener("scroll", scheduleSync, { passive: true });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    return () => {
      cancelAnimationFrame(syncFrame);
      scroller.removeEventListener("scroll", scheduleSync);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
    };
    // Re-bind when the layout changes (new run => new scrollHeight to track).
  }, [scrollRef, layout]);

  return (
    <div
      ref={containerRef}
      className="manuscript-map"
      role="img"
      aria-label={`Manuscript progress map — ${wordsLabel}`}
    >
      <canvas ref={canvasRef} className="map-canvas" aria-hidden="true" />
      <div ref={viewportRef} className="map-viewport" aria-hidden="true" />
    </div>
  );
});
```

- [ ] **Step 2: Wire the map into `ManuscriptPane`**

In `src/viewer/ui/components/ManuscriptPane.tsx`:

Add to the import block at the top:

```tsx
import { memo, useMemo, useRef, type ReactNode } from "react";

import { ManuscriptMap } from "./ManuscriptMap.js";
```

(Keep the existing `import type { ViewerRun }` and `replay-index.js` imports; only `useRef` and the `ManuscriptMap` import are new.)

Change `DecodedPaper` to accept and forward a scroll ref. Replace its signature and both `return` roots:

```tsx
const DecodedPaper = memo(function DecodedPaper({
  ciphertext,
  snapshot,
  scrollRef,
}: {
  ciphertext: string;
  snapshot: DecodeSnapshot | undefined;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lines = useMemo(() => tokenizeLines(ciphertext), [ciphertext]);
  if (snapshot === undefined)
    return (
      <div ref={scrollRef} className="decoded-paper is-raw">
        {ciphertext}
      </div>
    );
  return (
    <div ref={scrollRef} className="decoded-paper">
      {lines.map((line) => (
        <DecodedLine key={line.key} line={line} snapshot={snapshot} />
      ))}
    </div>
  );
});
```

In the `ManuscriptPane` body, create the ref just after `const active = snapshot?.checkpoint;`:

```tsx
  const scrollRef = useRef<HTMLDivElement | null>(null);
```

Replace the final `<DecodedPaper ... />` line at the bottom of the returned JSX with a body wrapper holding the paper and the map:

```tsx
      <div className="manuscript-body">
        <DecodedPaper ciphertext={run.ciphertext} snapshot={snapshot} scrollRef={scrollRef} />
        <ManuscriptMap
          ciphertext={run.ciphertext}
          snapshot={snapshot}
          scrollRef={scrollRef}
          wordsLabel={recovered}
        />
      </div>
```

(`recovered` is the existing local string built above; reuse it verbatim.)

- [ ] **Step 3: Add styles**

In `src/viewer/ui/styles.css`, replace the `.decoded-paper` rule's opening (the block starting at `.decoded-paper {`) is left as-is, and add these rules immediately after the `.state-changed-incorrect` rule (end of the manuscript block, before `/* ---------------- temporal register ---------------- */`):

```css
.manuscript-body {
  min-height: 0;
  display: flex;
  align-items: stretch;
}
.manuscript-body .decoded-paper {
  flex: 1 1 auto;
}
.manuscript-map {
  position: relative;
  flex: 0 0 68px;
  border-left: 1px solid var(--rule);
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  touch-action: none;
}
.map-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.map-viewport {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 0;
  background: rgba(51, 69, 107, 0.14);
  border: 1px solid var(--ink-blue-soft);
  border-radius: 1px;
  pointer-events: none;
}
@media (max-width: 980px) {
  .manuscript-map {
    display: none;
  }
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm typecheck && pnpm exec oxlint --deny-warnings src`
Expected: no errors. (If lint flags a `String()` wrap or a floating promise, address it — the codebase wraps interpolated numbers in `String(...)`, already done above.)

- [ ] **Step 5: Build the viewer bundle**

Run: `pnpm viewer:build`
Expected: build succeeds, no TS/Vite errors.

- [ ] **Step 6: Manual verification in the dev viewer**

Start the viewer against a recorded run and confirm the map behaves:

Run: `pnpm puzzle:view` (or the project's viewer dev command) and open the reported URL.
Verify:
1. A thin strip appears on the right of the Reconstruction panel showing the full text shape in faint marks.
2. As decode checkpoints stream, marks turn green (newly-correct) / ink (settled) / red (regressed) / amber (changed-incorrect), matching the text colors.
3. The translucent viewport box tracks scrolling of the text.
4. Clicking or dragging on the strip scrolls the text to that region.
5. Narrowing the window below ~980px hides the strip without breaking the layout.

- [ ] **Step 7: Format and commit**

```bash
pnpm exec oxfmt --config oxfmt.json --write src/viewer/ui/components/ManuscriptMap.tsx src/viewer/ui/components/ManuscriptPane.tsx src/viewer/ui/styles.css
git add src/viewer/ui/components/ManuscriptMap.tsx src/viewer/ui/components/ManuscriptPane.tsx src/viewer/ui/styles.css
git commit -m "feat(viewer): add manuscript minimap with viewport marker and click-to-jump"
```

---

## Self-Review

**1. Spec coverage:**
- Right-side vertical strip → `.manuscript-map` `flex: 0 0 68px`, `border-left`, inside `.manuscript-body` flex row (Task 2, steps 2–3). ✓
- Click-to-jump + viewport marker → `sync()` viewport box + `scrollToFraction` pointer handlers (Task 2, step 1). ✓
- Per-word marks, real line breaks → `flowRows` starts a fresh row per source line and sizes each mark by `cells = max(1, length)` (Task 2, step 1); `buildMapLayout` preserves blank lines (Task 1). ✓
- Canvas rendering, rAF-throttled, ResizeObserver → draw effect (Task 2, step 1). ✓
- State→color mirroring palette, ciphered check via `hasCandidate` → `stateColor` (Task 1) using `candidates[i] != null` (Task 2). ✓
- No snapshot → faint preview → `states`/`candidates` undefined ⇒ `stateColor(0, false)` = ciphered (Task 2, step 1). ✓
- Failed/empty checkpoint keeps prior colors → relies on existing `appendDecodeCheckpoint` carry-forward; no special path needed. ✓
- Empty ciphertext / zero words guarded → `total <= 0` and `width/height <= 0` guards; `flowRows` always yields ≥1 row. ✓
- Mobile hide at existing breakpoint → `@media (max-width: 980px)` (Task 2, step 3). ✓
- Accessibility `role="img"` + aria-label from `wordsLabel` → container attrs (Task 2, step 1), `wordsLabel={recovered}` (step 2). ✓
- Tests for `buildMapLayout` + `stateColor` → Task 1. ✓
- No contract/stream/server change → only `replay-index.ts`, two components, `styles.css` touched. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step is concrete. Manual-verification step lists explicit checks rather than "test it". ✓

**3. Type consistency:** `MapLayout`/`MapWord`/`MapLine` defined in Task 1 and consumed by `buildMapLayout`'s return in Task 2's `flowRows` param (`ReturnType<typeof buildMapLayout>["lines"]`). `stateColor(state: number, hasCandidate: boolean)` signature identical across Task 1 def and Task 2 call. `scrollRef: RefObject<HTMLDivElement | null>` consistent across `ManuscriptMap`, `DecodedPaper`, and the `useRef<HTMLDivElement | null>(null)` in `ManuscriptPane`. `DecodeSnapshot.states` is `Uint8Array` and `.candidates` is `(string | null | undefined)[]` — matched by `states?.[i] ?? 0` and `candidates[i] != null`. ✓
