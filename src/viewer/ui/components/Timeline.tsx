import { memo, useMemo, type RefObject } from "react";

import type { DecodeCheckpoint, ViewerEventCategory, ViewerRun } from "../../contracts.js";
import { CATEGORIES, SPEEDS } from "../constants.js";
import { formatTime } from "../format.js";
import { upperBound } from "../replay-index.js";

const TimelineMarkers = memo(function TimelineMarkers({
  run,
  filters,
  checkpoints,
  onSeek,
}: {
  run: ViewerRun;
  filters: ReadonlySet<ViewerEventCategory>;
  checkpoints: readonly DecodeCheckpoint[];
  onSeek: (value: number) => void;
}) {
  return (
    <>
      {run.events.map((event) =>
        filters.has(event.category) ? (
          <button
            aria-label={`${event.kind} at ${formatTime(event.atMs)}`}
            className={`event-tick category-${event.category}`}
            key={event.sequence}
            onClick={() => onSeek(event.atMs)}
            style={{ left: `${(event.atMs / Math.max(1, run.durationMs)) * 100}%` }}
            title={`${formatTime(event.atMs)} ${event.kind}`}
          />
        ) : null,
      )}
      {checkpoints.map((checkpoint) => (
        <button
          aria-label={`Decode checkpoint at ${formatTime(checkpoint.atMs)}`}
          className="event-tick decode-tick"
          key={checkpoint.checkpointId}
          onClick={() => onSeek(checkpoint.atMs)}
          style={{ left: `${(checkpoint.atMs / Math.max(1, run.durationMs)) * 100}%` }}
        />
      ))}
    </>
  );
});

export const Timeline = memo(function Timeline({
  run,
  contentTime,
  playing,
  togglePlaying,
  speed,
  setSpeed,
  filters,
  toggleFilter,
  checkpoints,
  onSeek,
  sliderRef,
  clockRef,
}: {
  run: ViewerRun;
  contentTime: number;
  playing: boolean;
  togglePlaying: () => void;
  speed: number;
  setSpeed: (value: number) => void;
  filters: ReadonlySet<ViewerEventCategory>;
  toggleFilter: (category: ViewerEventCategory) => void;
  checkpoints: readonly DecodeCheckpoint[];
  onSeek: (value: number) => void;
  sliderRef: RefObject<HTMLInputElement | null>;
  clockRef: RefObject<HTMLTimeElement | null>;
}) {
  const times = useMemo(
    () =>
      [
        ...new Set([
          ...run.events.filter(({ category }) => filters.has(category)).map(({ atMs }) => atMs),
          ...checkpoints.map(({ atMs }) => atMs),
        ]),
      ].sort((left, right) => left - right),
    [checkpoints, filters, run.events],
  );
  const previous = () => onSeek(times[upperBound(times, contentTime - 1) - 1] ?? 0);
  const next = () => onSeek(times[upperBound(times, contentTime + 1)] ?? run.durationMs);
  return (
    <footer className="timeline-shell">
      <div className="filter-row">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            className={filters.has(category) ? "active" : ""}
            onClick={() => toggleFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="timeline-track">
        <TimelineMarkers run={run} filters={filters} checkpoints={checkpoints} onSeek={onSeek} />
        <input
          aria-label="Run playhead"
          ref={sliderRef}
          type="range"
          min="0"
          max={Math.max(1, run.durationMs)}
          value={contentTime}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      <div className="transport-row">
        <div className="transport-clock">
          <time ref={clockRef}>{formatTime(contentTime)}</time>
          <span>/ {formatTime(run.durationMs)}</span>
        </div>
        <div className="transport-controls">
          <button onClick={previous} aria-label="Previous event">
            Prev
          </button>
          <button className="play-button" onClick={togglePlaying}>
            {playing ? "Pause" : "Play"}
          </button>
          <button onClick={next} aria-label="Next event">
            Next
          </button>
        </div>
        <label>
          Speed
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
      </div>
    </footer>
  );
});
