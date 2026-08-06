import { useCallback, useEffect, useMemo, useState } from "react";

import type { ViewerEventCategory, ViewerSessionUsage } from "../contracts.js";
import { AgentLane } from "./components/AgentLane.js";
import { ManuscriptPane } from "./components/ManuscriptPane.js";
import { RunBanner } from "./components/RunBanner.js";
import { TeamRoom } from "./components/TeamRoom.js";
import { Timeline } from "./components/Timeline.js";
import { CATEGORIES, MOBILE_PANELS, type MobilePanel } from "./constants.js";
import { useDecodeStream } from "./hooks/useDecodeStream.js";
import { usePlayback } from "./hooks/usePlayback.js";
import { useRunRecord } from "./hooks/useRunRecord.js";
import { buildViewerReplayIndex, filterViewerLane, upperBound } from "./replay-index.js";

export function App() {
  const { run, loadError } = useRunRecord();
  const { snapshots, replayStatus } = useDecodeStream(run);

  const [filters, setFilters] = useState<Set<ViewerEventCategory>>(() => new Set(CATEGORIES));
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("agents");
  const [originId, setOriginId] = useState("shared");
  useEffect(() => {
    if (run !== undefined) setOriginId(run.origins[0]?.originId ?? "shared");
  }, [run]);

  const replayIndex = useMemo(
    () => (run === undefined ? undefined : buildViewerReplayIndex(run)),
    [run],
  );
  const lanes = useMemo(
    () => replayIndex?.lanes.map((lane) => filterViewerLane(lane, filters)) ?? [],
    [filters, replayIndex],
  );
  const checkpoints = useMemo(() => snapshots.map(({ checkpoint }) => checkpoint), [snapshots]);
  const originSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.checkpoint.originId === originId),
    [originId, snapshots],
  );
  const originCheckpointTimes = useMemo(
    () => originSnapshots.map(({ checkpoint }) => checkpoint.atMs),
    [originSnapshots],
  );

  // Every time at which something on screen changes. The playback clock only
  // publishes a React update when the playhead crosses one of these.
  const boundaries = useMemo(() => {
    const times = new Set<number>();
    for (const lane of lanes) for (const time of lane.transitionTimes) times.add(time);
    for (const time of originCheckpointTimes) times.add(time);
    if (replayIndex !== undefined) for (const time of replayIndex.teamMessageTimes) times.add(time);
    return [...times].sort((left, right) => left - right);
  }, [lanes, originCheckpointTimes, replayIndex]);

  const { contentTime, playing, speed, togglePlaying, setSpeed, seek, sliderRef, clockRef } =
    usePlayback({ durationMs: run?.durationMs ?? 0, boundaries });

  const visibleCheckpointCount = upperBound(originCheckpointTimes, contentTime);
  const activeSnapshot = originSnapshots[visibleCheckpointCount - 1];
  const teamVisibleCount =
    replayIndex === undefined ? 0 : upperBound(replayIndex.teamMessageTimes, contentTime);

  const toggleFilter = useCallback((category: ViewerEventCategory) => {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  // Toggle a group of categories together (the "system" chip). If every member
  // is already shown, hide them all; otherwise show them all.
  const toggleCategories = useCallback((categories: readonly ViewerEventCategory[]) => {
    setFilters((current) => {
      const next = new Set(current);
      const allOn = categories.every((category) => next.has(category));
      for (const category of categories) {
        if (allOn) next.delete(category);
        else next.add(category);
      }
      return next;
    });
  }, []);

  const sessionByAgent = useMemo(
    () =>
      new Map<string, ViewerSessionUsage>(
        run?.agents.map((agent) => [agent.agentId, agent.session]) ?? [],
      ),
    [run],
  );

  if (loadError !== undefined)
    return (
      <main className="fatal-screen">
        <h1>Replay unavailable</h1>
        <p>{loadError}</p>
      </main>
    );
  if (run === undefined || replayIndex === undefined)
    return (
      <main className="loading-screen">
        <span />
        <p>Opening the run record</p>
      </main>
    );

  return (
    <div className="app-shell">
      <RunBanner run={run} />
      <nav className="mobile-tabs" aria-label="Replay panels">
        {MOBILE_PANELS.map(({ id, label }) => (
          <button
            key={id}
            className={mobilePanel === id ? "active" : ""}
            onClick={() => setMobilePanel(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="replay-grid" data-mobile-panel={mobilePanel}>
        <div
          className="observation-side"
          data-has-team={run.communicationMode === "shared" ? "true" : "false"}
        >
          <div className="agent-grid">
            {lanes.map((lane) => {
              const boundaryIndex = upperBound(lane.transitionTimes, contentTime);
              return (
                <AgentLane
                  key={lane.agentId}
                  lane={lane}
                  session={sessionByAgent.get(lane.agentId)}
                  boundaryTime={lane.transitionTimes[boundaryIndex - 1] ?? -1}
                  playing={playing}
                />
              );
            })}
          </div>
          {run.communicationMode === "shared" ? (
            <TeamRoom messages={run.teamMessages} visibleCount={teamVisibleCount} />
          ) : null}
        </div>
        <ManuscriptPane
          run={run}
          snapshot={activeSnapshot}
          replayStatus={replayStatus}
          originId={originId}
          visibleCheckpointCount={visibleCheckpointCount}
          checkpointCount={originSnapshots.length}
          onOriginChange={setOriginId}
        />
      </main>
      <Timeline
        run={run}
        contentTime={contentTime}
        playing={playing}
        togglePlaying={togglePlaying}
        speed={speed}
        setSpeed={setSpeed}
        filters={filters}
        toggleFilter={toggleFilter}
        toggleCategories={toggleCategories}
        checkpoints={checkpoints}
        onSeek={seek}
        sliderRef={sliderRef}
        clockRef={clockRef}
      />
    </div>
  );
}
