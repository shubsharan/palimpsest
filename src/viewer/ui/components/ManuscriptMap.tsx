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
function flowRows(lines: ReturnType<typeof buildMapLayout>["lines"], cols: number): PlacedWord[][] {
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
          const hasCandidate = candidates !== undefined && candidates[word.wordIndex] != null;
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
      if (rect.height <= 0) return;
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
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(container);
    resizeObserver.observe(scroller);
    return () => {
      cancelAnimationFrame(syncFrame);
      scroller.removeEventListener("scroll", scheduleSync);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
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
