import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { formatTime } from "../format.js";
import { replayTimeAt, upperBound } from "../replay-index.js";

const STEP_MS = 5_000;

export interface UsePlaybackArgs {
  durationMs: number;
  // Sorted times at which visible content changes. Between two adjacent
  // boundaries nothing on screen changes except the playhead itself.
  boundaries: readonly number[];
}

export interface Playback {
  playing: boolean;
  speed: number;
  // Drives all time-derived content. Updated only when the playhead crosses a
  // boundary (or on seek / boundary-set change) — never once per animation frame.
  contentTime: number;
  setPlaying: (value: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (value: number) => void;
  seek: (value: number) => void;
  // Attach to the continuous UI: the rAF loop writes these directly so the thumb
  // and clock move at display refresh rate without re-rendering React.
  sliderRef: RefObject<HTMLInputElement | null>;
  clockRef: RefObject<HTMLTimeElement | null>;
}

// Playback separates two clocks that used to be one. The *continuous* clock (the
// moving thumb and ticking digits) is written straight to the DOM every frame.
// The *discrete* clock (which cards, checkpoints, and messages are visible) is
// React state that only advances when a boundary is crossed. During the quiet
// stretches between events, playback costs two DOM writes per frame and zero
// React renders.
export function usePlayback({ durationMs, boundaries }: UsePlaybackArgs): Playback {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [contentTime, setContentTime] = useState(0);

  const playheadRef = useRef(0);
  const sliderRef = useRef<HTMLInputElement | null>(null);
  const clockRef = useRef<HTMLTimeElement | null>(null);

  // Latest values read inside the rAF loop without restarting it every render.
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const boundariesRef = useRef(boundaries);
  boundariesRef.current = boundaries;
  const publishedIndexRef = useRef(-1);

  const paint = useCallback((ms: number) => {
    playheadRef.current = ms;
    if (sliderRef.current !== null) sliderRef.current.value = String(ms);
    if (clockRef.current !== null) clockRef.current.textContent = formatTime(ms);
  }, []);

  const publish = useCallback((ms: number) => {
    const index = upperBound(boundariesRef.current, ms);
    if (index !== publishedIndexRef.current) {
      publishedIndexRef.current = index;
      setContentTime(ms);
    }
  }, []);

  const seek = useCallback(
    (value: number) => {
      const bounded = Math.min(durationRef.current, Math.max(0, value));
      setPlaying(false);
      paint(bounded);
      publishedIndexRef.current = upperBound(boundariesRef.current, bounded);
      setContentTime(bounded);
    },
    [paint],
  );

  const togglePlaying = useCallback(() => setPlaying((current) => !current), []);

  // When the boundary set changes (filters, origin, or a newly streamed
  // checkpoint) re-derive content for the current playhead.
  useEffect(() => {
    publishedIndexRef.current = upperBound(boundaries, playheadRef.current);
    setContentTime(playheadRef.current);
  }, [boundaries]);

  // The animation loop. Restarts only when play state or speed changes; the
  // duration and boundaries are read through refs so scrubbing data in mid-play
  // never tears it down.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const anchorClock = performance.now();
    const anchorPlayhead = playheadRef.current;
    const advance = (now: number) => {
      const next = replayTimeAt(anchorPlayhead, now - anchorClock, speed, durationRef.current);
      paint(next);
      publish(next);
      if (next >= durationRef.current) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, paint, publish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlaying();
      } else if (event.code === "ArrowLeft") {
        seek(playheadRef.current - STEP_MS);
      } else if (event.code === "ArrowRight") {
        seek(playheadRef.current + STEP_MS);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seek, togglePlaying]);

  return {
    playing,
    speed,
    contentTime,
    setPlaying,
    togglePlaying,
    setSpeed,
    seek,
    sliderRef,
    clockRef,
  };
}
