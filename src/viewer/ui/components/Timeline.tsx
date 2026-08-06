import { memo, useMemo, type RefObject } from "react";

import type { DecodeCheckpoint, ViewerEventCategory, ViewerRun } from "../../contracts.js";
import { PRIMARY_CATEGORIES, SPEEDS, SYSTEM_CATEGORIES } from "../constants.js";
import { formatTime } from "../format.js";
import { upperBound } from "../replay-index.js";

function percentOf(value: number, durationMs: number): number {
  return Math.min(100, Math.max(0, (value / Math.max(1, durationMs)) * 100));
}

// The evidence schedule and the re-key boundary drawn as first-class marks above
// the scrub track: labeled release pins (the re-key distinguished by an ink-blue
// pin and label, not extra chrome) and a clamped cutoff marker (the cutoff can
// fall past the run's actual end).
const ScheduleRail = memo(function ScheduleRail({ run }: { run: ViewerRun }) {
  const cutoffPast = run.schedule.cutoffMs > run.durationMs;
  return (
    <div className="schedule-rail" aria-label="Evidence schedule">
      <div className="rail-line" />
      {run.schedule.releases.map((release) => (
        <div
          key={release.ordinal}
          className={`release-mark${release.isRekey ? " is-rekey" : ""}`}
          style={{ left: `${String(percentOf(release.offsetMs, run.durationMs))}%` }}
        >
          <span className="release-pin" />
          <span className="release-lab">
            {release.isRekey ? `re-key · drop ${release.ordinal}` : `drop ${release.ordinal}`}
          </span>
        </div>
      ))}
      <div
        className={`cutoff-mark${cutoffPast ? " is-past" : ""}`}
        style={{ left: `${String(percentOf(run.schedule.cutoffMs, run.durationMs))}%` }}
        title={
          cutoffPast
            ? `Cutoff ${formatTime(run.schedule.cutoffMs)} — past the run's actual end`
            : `Cutoff ${formatTime(run.schedule.cutoffMs)}`
        }
      >
        <span className="cutoff-bar" />
        <span className="cutoff-lab">cutoff{cutoffPast ? " ↦" : ""}</span>
      </div>
    </div>
  );
});

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
            style={{ left: `${String(percentOf(event.atMs, run.durationMs))}%` }}
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
          style={{ left: `${String(percentOf(checkpoint.atMs, run.durationMs))}%` }}
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
  toggleCategories,
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
  toggleCategories: (categories: readonly ViewerEventCategory[]) => void;
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
  const systemOn = SYSTEM_CATEGORIES.every((category) => filters.has(category));
  return (
    <footer className="timeline-shell">
      <ScheduleRail run={run} />
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
          <span> / {formatTime(run.durationMs)}</span>
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
        <div className="timeline-tools">
          <div className="filter-row">
            {PRIMARY_CATEGORIES.map((category) => (
              <button
                key={category}
                className={`chip${filters.has(category) ? " active" : ""}`}
                onClick={() => toggleFilter(category)}
              >
                {category}
              </button>
            ))}
            <button
              className={`chip${systemOn ? " active" : ""}`}
              onClick={() => toggleCategories(SYSTEM_CATEGORIES)}
              title="Session, run, evaluation, and infrastructure events"
            >
              system
            </button>
          </div>
          <label className="speed-sel">
            speed
            <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </footer>
  );
});
