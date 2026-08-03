import "@fontsource-variable/newsreader/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import React, {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import type {
  DecodeCheckpoint,
  DecodeStreamEvent,
  ViewerEvent,
  ViewerEventCategory,
  ViewerRun,
  ViewerTeamMessage,
  ViewerToolCall,
  ViewerToolDetail,
} from "../contracts.js";
import {
  appendDecodeCheckpoint,
  buildViewerReplayIndex,
  countCiphertextWords,
  decodeStateName,
  filterViewerLane,
  replayTimeAt,
  upperBound,
  type DecodeSnapshot,
  type ViewerLaneIndex,
} from "./replay-index.js";
import "./styles.css";

const CATEGORIES: readonly ViewerEventCategory[] = [
  "model",
  "tool",
  "team",
  "stage",
  "git",
  "session",
  "run",
  "evaluation",
  "infrastructure",
];
const SPEEDS = [1, 10, 60, 300] as const;
const CLOCK_PUBLISH_INTERVAL_MS = 50;
const toolDetailCache = new Map<number, Promise<ViewerToolDetail>>();

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3_600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? "--" : `${(value * 100).toFixed(2)}%`;
}

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function loadToolDetail(startedSequence: number): Promise<ViewerToolDetail> {
  const cached = toolDetailCache.get(startedSequence);
  if (cached !== undefined) return cached;
  const pending = fetch(`/api/tool/${String(startedSequence)}`).then(async (response) => {
    if (!response.ok) throw new Error(`Tool detail API returned ${String(response.status)}.`);
    return (await response.json()) as ViewerToolDetail;
  });
  toolDetailCache.set(startedSequence, pending);
  void pending.catch(() => toolDetailCache.delete(startedSequence));
  return pending;
}

const ResponseCard = memo(function ResponseCard({ event }: { event: ViewerEvent }) {
  const display = event.display;
  if (display?.type !== "model-response") return null;
  return (
    <article className="stream-card response-card">
      <header>
        <span>Model response</span>
        <time>{formatTime(event.atMs)}</time>
      </header>
      {display.providerSummary === undefined ? null : (
        <details className="reasoning-note">
          <summary>Provider-returned reasoning summary</summary>
          <p>{display.providerSummary}</p>
        </details>
      )}
      {display.reasoningSummary === undefined ? null : (
        <details className="reasoning-note">
          <summary>Observable reasoning text</summary>
          <p>{display.reasoningSummary}</p>
        </details>
      )}
      <p className={display.finalResponse === undefined ? "empty-response" : "model-copy"}>
        {display.finalResponse ?? "Tool-directed turn; no model text was returned."}
      </p>
      {display.outputTokens === undefined ? null : (
        <footer>{display.outputTokens.toLocaleString()} output tokens</footer>
      )}
    </article>
  );
});

const ToolCard = memo(function ToolCard({
  call,
  completed,
}: {
  call: ViewerToolCall;
  completed: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [detail, setDetail] = useState<ViewerToolDetail>();
  const [detailError, setDetailError] = useState<string>();
  const status = completed ? call.status : "running";
  const elapsed = completed
    ? Math.max(0, (call.completedAtMs ?? call.startedAtMs) - call.startedAtMs)
    : undefined;
  const open = () => {
    if (opened) return;
    setOpened(true);
    void loadToolDetail(call.startedSequence).then(
      (loaded) => setDetail(loaded),
      (error: unknown) => setDetailError(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <details
      className={`stream-card tool-card status-${status}`}
      onToggle={(event) => {
        if (event.currentTarget.open) open();
      }}
    >
      <summary>
        <span className="tool-status" aria-hidden="true" />
        <span>{call.name}</span>
        <time>{elapsed === undefined ? "running" : `${(elapsed / 1_000).toFixed(1)}s`}</time>
      </summary>
      {!opened ? null : detailError !== undefined ? (
        <div className="tool-detail">
          <h4>Detail unavailable</h4>
          <pre>{detailError}</pre>
        </div>
      ) : detail === undefined ? (
        <div className="tool-detail tool-detail-loading">Loading tool detail.</div>
      ) : (
        <div className="tool-detail">
          <h4>Arguments</h4>
          <pre>{jsonText(detail.arguments)}</pre>
          {!completed ? null : detail.error === undefined ? (
            <>
              <h4>Output</h4>
              <pre>{jsonText(detail.output ?? null)}</pre>
            </>
          ) : (
            <>
              <h4>Error</h4>
              <pre>{detail.error}</pre>
            </>
          )}
        </div>
      )}
    </details>
  );
});

const MilestoneCard = memo(function MilestoneCard({ event }: { event: ViewerEvent }) {
  const display = event.display;
  if (display?.type !== "milestone") return null;
  return (
    <article className={`milestone-card category-${event.category}`}>
      <span>{display.label}</span>
      <time>{formatTime(event.atMs)}</time>
    </article>
  );
});

const AgentLane = memo(function AgentLane({
  lane,
  boundaryTime,
  playing,
}: {
  lane: ViewerLaneIndex;
  boundaryTime: number;
  playing: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleCount = upperBound(lane.itemTimes, boundaryTime);
  useEffect(() => {
    if (playing) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [visibleCount, playing]);
  return (
    <section className="agent-lane" data-agent={lane.agentId}>
      <header className="lane-header">
        <span className="agent-mark" aria-hidden="true" />
        <div>
          <h2>{lane.agentId}</h2>
          <p>{lane.model}</p>
        </div>
      </header>
      <div className="lane-stream" ref={scrollRef}>
        {visibleCount === 0 ? <p className="waiting-copy">Waiting for the playhead.</p> : null}
        {lane.items
          .slice(0, visibleCount)
          .map((item) =>
            item.kind === "tool" ? (
              <ToolCard
                key={`tool-${String(item.sequence)}`}
                call={item.call}
                completed={
                  item.call.completedAtMs !== undefined && item.call.completedAtMs <= boundaryTime
                }
              />
            ) : item.event.display?.type === "model-response" ? (
              <ResponseCard key={`event-${String(item.sequence)}`} event={item.event} />
            ) : (
              <MilestoneCard key={`event-${String(item.sequence)}`} event={item.event} />
            ),
          )}
      </div>
    </section>
  );
});

const TeamRoom = memo(function TeamRoom({
  messages,
  visibleCount,
}: {
  messages: readonly ViewerTeamMessage[];
  visibleCount: number;
}) {
  return (
    <section className="team-room">
      <header>
        <div>
          <span className="eyebrow">Shared channel</span>
          <h2>Team room</h2>
        </div>
        <span className="message-count">
          {visibleCount} / {messages.length}
        </span>
      </header>
      <div className="team-scroll">
        {visibleCount === 0 ? (
          <p className="waiting-copy">No messages at this point in the run.</p>
        ) : (
          messages.slice(0, visibleCount).map((message) => (
            <article key={message.sequence} data-agent={message.author}>
              <header>
                <strong>{message.author}</strong>
                <time>{formatTime(message.atMs)}</time>
              </header>
              <p>{message.message}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
});

interface TextSpan {
  surface: string;
  wordIndex?: number;
}

interface TextLine {
  key: number;
  spans: readonly TextSpan[];
}

function tokenizeLines(value: string): TextLine[] {
  const expression = /\p{L}+(?:['\u2019]\p{L}+)*/gu;
  let wordIndex = 0;
  return value.split("\n").map((line, key) => {
    const spans: TextSpan[] = [];
    let cursor = 0;
    for (const match of line.matchAll(expression)) {
      const index = match.index;
      if (index > cursor) spans.push({ surface: line.slice(cursor, index) });
      spans.push({ surface: match[0], wordIndex });
      wordIndex += 1;
      cursor = index + match[0].length;
    }
    if (cursor < line.length) spans.push({ surface: line.slice(cursor) });
    return { key, spans };
  });
}

const DecodedLine = memo(function DecodedLine({
  line,
  snapshot,
}: {
  line: TextLine;
  snapshot: DecodeSnapshot;
}) {
  const content: React.ReactNode[] = [];
  let plain = "";
  const flush = () => {
    if (plain.length === 0) return;
    content.push(plain);
    plain = "";
  };
  for (let spanIndex = 0; spanIndex < line.spans.length; spanIndex += 1) {
    const span = line.spans[spanIndex]!;
    if (span.wordIndex === undefined) {
      plain += span.surface;
      continue;
    }
    const candidate = snapshot.candidates[span.wordIndex];
    const state = decodeStateName(snapshot.states[span.wordIndex] ?? 0);
    if (candidate === undefined && state === "unchanged") {
      plain += span.surface;
      continue;
    }
    flush();
    const following = line.spans[spanIndex + 1];
    const suffix = following?.wordIndex === undefined ? following.surface : "";
    if (suffix.length > 0) spanIndex += 1;
    content.push(
      <span
        id={`decode-word-${String(span.wordIndex)}`}
        key={span.wordIndex}
        className={`decode-word state-${state}`}
        title={`Cipher: ${span.surface} | Candidate: ${candidate ?? "missing"}`}
      >
        {candidate ?? "[missing]"}
        {suffix}
      </span>,
    );
  }
  flush();
  return <div className="decode-paragraph">{content.length === 0 ? "\u00a0" : content}</div>;
});

const DecodedPaper = memo(function DecodedPaper({
  ciphertext,
  snapshot,
}: {
  ciphertext: string;
  snapshot: DecodeSnapshot | undefined;
}) {
  const lines = useMemo(() => tokenizeLines(ciphertext), [ciphertext]);
  if (snapshot === undefined) return <div className="decoded-paper">{ciphertext}</div>;
  return (
    <div className="decoded-paper">
      {lines.map((line) => (
        <DecodedLine key={line.key} line={line} snapshot={snapshot} />
      ))}
    </div>
  );
});

const DecodePane = memo(function DecodePane({
  run,
  snapshot,
  replayStatus,
  originId,
  visibleCheckpointCount,
  checkpointCount,
  onOriginChange,
}: {
  run: ViewerRun;
  snapshot: DecodeSnapshot | undefined;
  replayStatus: string;
  originId: string;
  visibleCheckpointCount: number;
  checkpointCount: number;
  onOriginChange: (originId: string) => void;
}) {
  const active = snapshot?.checkpoint;
  const jumpTo = (index: number) => {
    document.getElementById(`decode-word-${String(index)}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  return (
    <section className="decode-pane">
      <header className="decode-header">
        <div>
          <span className="eyebrow">Published solver</span>
          <h2>Reconstruction</h2>
        </div>
        {run.origins.length > 1 ? (
          <label>
            Origin
            <select value={originId} onChange={(event) => onOriginChange(event.target.value)}>
              {run.origins.map((origin) => (
                <option key={origin.originId}>{origin.originId}</option>
              ))}
            </select>
          </label>
        ) : null}
      </header>
      <div className="decode-metrics">
        <div>
          <span>Accuracy</span>
          <strong>{formatPercent(active?.accuracy)}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{formatPercent(active?.coverage)}</strong>
        </div>
        <div>
          <span>Checkpoint</span>
          <strong>
            {visibleCheckpointCount}/{checkpointCount}
          </strong>
        </div>
      </div>
      <div className="checkpoint-note">
        {active === undefined ? (
          <p>
            {replayStatus === "preparing"
              ? "Preparing solver checkpoints in the recorded sandbox."
              : replayStatus === "complete"
                ? "Ciphertext at time zero."
                : `Decode replay unavailable: ${replayStatus}`}
          </p>
        ) : active.status === "failed" ? (
          <p className="checkpoint-error">
            <strong>Checkpoint unavailable.</strong> {active.error}
          </p>
        ) : (
          <>
            <div>
              <span className={`timing-badge timing-${active.timing}`}>{active.timing} time</span>
              <code>{active.commit.slice(0, 8)}</code>
              <span>{active.author}</span>
            </div>
            <p>{active.subject || "Published solver update"}</p>
            {(active.newlyCorrectRanges?.length ?? 0) > 0 ? (
              <nav aria-label="Newly decoded ranges">
                {active.newlyCorrectRanges!.slice(0, 6).map((range) => (
                  <button key={`${range.start}-${range.end}`} onClick={() => jumpTo(range.start)}>
                    words {range.start + 1}-{range.end + 1}
                  </button>
                ))}
              </nav>
            ) : null}
          </>
        )}
      </div>
      <div className="decode-key" aria-label="Decode highlight legend">
        <span className="key-new">newly correct</span>
        <span className="key-known">previously correct</span>
        <span className="key-regressed">regressed</span>
        <span className="key-changed">changed, incorrect</span>
      </div>
      <DecodedPaper ciphertext={run.ciphertext} snapshot={snapshot} />
    </section>
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

function Timeline({
  run,
  playhead,
  playing,
  setPlaying,
  speed,
  setSpeed,
  filters,
  toggleFilter,
  checkpoints,
  onSeek,
}: {
  run: ViewerRun;
  playhead: number;
  playing: boolean;
  setPlaying: (value: boolean) => void;
  speed: number;
  setSpeed: (value: number) => void;
  filters: ReadonlySet<ViewerEventCategory>;
  toggleFilter: (category: ViewerEventCategory) => void;
  checkpoints: readonly DecodeCheckpoint[];
  onSeek: (value: number) => void;
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
  const previous = () => onSeek(times[upperBound(times, playhead - 1) - 1] ?? 0);
  const next = () => onSeek(times[upperBound(times, playhead + 1)] ?? run.durationMs);
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
          type="range"
          min="0"
          max={Math.max(1, run.durationMs)}
          value={playhead}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      <div className="transport-row">
        <time>
          {formatTime(playhead)} <span>/ {formatTime(run.durationMs)}</span>
        </time>
        <div className="transport-controls">
          <button onClick={previous} aria-label="Previous event">
            Prev
          </button>
          <button className="play-button" onClick={() => setPlaying(!playing)}>
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
}

function App() {
  const [run, setRun] = useState<ViewerRun>();
  const [loadError, setLoadError] = useState<string>();
  const [snapshots, setSnapshots] = useState<readonly DecodeSnapshot[]>([]);
  const snapshotsRef = useRef<readonly DecodeSnapshot[]>([]);
  const [replayStatus, setReplayStatus] = useState("preparing");
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(60);
  const [filters, setFilters] = useState<Set<ViewerEventCategory>>(() => new Set(CATEGORIES));
  const [mobilePanel, setMobilePanel] = useState("agents");
  const [originId, setOriginId] = useState("shared");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/run", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Viewer API returned ${String(response.status)}.`);
        const loaded = (await response.json()) as ViewerRun;
        setRun(loaded);
        setOriginId(loaded.origins[0]?.originId ?? "shared");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (run === undefined) return;
    const wordCount = countCiphertextWords(run.ciphertext);
    const source = new EventSource("/api/decode/events");
    source.addEventListener("replay", (rawEvent) => {
      const event = JSON.parse((rawEvent as MessageEvent<string>).data) as DecodeStreamEvent;
      if (event.type === "checkpoint") {
        try {
          const next = appendDecodeCheckpoint(snapshotsRef.current, event.checkpoint, wordCount);
          snapshotsRef.current = next;
          startTransition(() => setSnapshots(next));
        } catch (error) {
          setReplayStatus(error instanceof Error ? error.message : String(error));
          source.close();
        }
      } else if (event.type === "complete") {
        setReplayStatus("complete");
        source.close();
      } else if (event.type === "failed") {
        setReplayStatus(event.error);
        source.close();
      }
    });
    source.onerror = () => {
      setReplayStatus((current) =>
        current === "complete" ? current : "Replay stream interrupted.",
      );
    };
    return () => source.close();
  }, [run]);

  const commitPlayhead = useCallback(
    (value: number) => {
      const bounded = Math.min(run?.durationMs ?? value, Math.max(0, value));
      playheadRef.current = bounded;
      setPlayhead(bounded);
    },
    [run?.durationMs],
  );
  const seek = useCallback(
    (value: number) => {
      setPlaying(false);
      commitPlayhead(value);
    },
    [commitPlayhead],
  );

  useEffect(() => {
    if (!playing || run === undefined) return;
    let frame = 0;
    const anchorTime = performance.now();
    const anchorPlayhead = playheadRef.current;
    let lastPublished = anchorTime - CLOCK_PUBLISH_INTERVAL_MS;
    const advance = (now: number) => {
      const next = replayTimeAt(anchorPlayhead, now - anchorTime, speed, run.durationMs);
      if (now - lastPublished >= CLOCK_PUBLISH_INTERVAL_MS || next >= run.durationMs) {
        playheadRef.current = next;
        setPlayhead(next);
        lastPublished = now;
      }
      if (next >= run.durationMs) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, run, speed]);

  useEffect(() => {
    if (run === undefined) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((current) => !current);
      } else if (event.code === "ArrowLeft") {
        seek(playheadRef.current - 5_000);
      } else if (event.code === "ArrowRight") {
        seek(playheadRef.current + 5_000);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [run, seek]);

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
  const visibleCheckpointCount = upperBound(originCheckpointTimes, playhead);
  const activeSnapshot = originSnapshots[visibleCheckpointCount - 1];
  const teamVisibleCount =
    replayIndex === undefined ? 0 : upperBound(replayIndex.teamMessageTimes, playhead);
  const toggleFilter = useCallback((category: ViewerEventCategory) => {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

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
      <header className="run-header">
        <div className="brand-lockup">
          <span className="brand-index">P</span>
          <div>
            <span>Palimpsest field record</span>
            <h1>{run.runId}</h1>
          </div>
        </div>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{run.status}</dd>
          </div>
          <div>
            <dt>Regime</dt>
            <dd>{run.variantId}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{run.communicationMode}</dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd>{run.agents.length}</dd>
          </div>
        </dl>
      </header>
      <nav className="mobile-tabs" aria-label="Replay panels">
        {[
          ["agents", "Agents"],
          ["team", "Team room"],
          ["decode", "Decode"],
        ].map(([id, label]) => (
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
        <div className="observation-side">
          <div className="agent-grid">
            {lanes.map((lane) => {
              const boundaryIndex = upperBound(lane.transitionTimes, playhead);
              return (
                <AgentLane
                  key={lane.agentId}
                  lane={lane}
                  boundaryTime={lane.transitionTimes[boundaryIndex - 1] ?? -1}
                  playing={playing}
                />
              );
            })}
          </div>
          <TeamRoom messages={run.teamMessages} visibleCount={teamVisibleCount} />
        </div>
        <DecodePane
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
        playhead={playhead}
        playing={playing}
        setPlaying={setPlaying}
        speed={speed}
        setSpeed={setSpeed}
        filters={filters}
        toggleFilter={toggleFilter}
        checkpoints={checkpoints}
        onSeek={seek}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Viewer root element is missing.");
createRoot(root).render(<App />);
