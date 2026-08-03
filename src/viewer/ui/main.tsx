import "@fontsource-variable/newsreader/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  DecodeCheckpoint,
  DecodeStreamEvent,
  DecodeWordState,
  ViewerEvent,
  ViewerEventCategory,
  ViewerRun,
  ViewerToolCall,
} from "../contracts.js";
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

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

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

function returnedSummary(value: unknown): string | undefined {
  const root = object(value);
  if (root?.status !== "captured" || !Array.isArray(root.items)) return undefined;
  const text = root.items.flatMap((rawItem) => {
    const item = object(rawItem);
    if (!Array.isArray(item?.summary)) return [];
    return item.summary.flatMap((rawEntry) => {
      const entry = object(rawEntry);
      return typeof entry?.text === "string" ? [entry.text] : [];
    });
  });
  return text.length === 0 ? undefined : text.join("\n\n");
}

function ResponseCard({ event }: { event: ViewerEvent }) {
  const data = object(event.data);
  const finalResponse = typeof data?.finalResponse === "string" ? data.finalResponse : undefined;
  const reasoningSummary =
    typeof data?.reasoningSummary === "string" ? data.reasoningSummary : undefined;
  const providerSummary = returnedSummary(data?.returnedReasoningSummary);
  const usage = object(data?.usage);
  return (
    <article className="stream-card response-card">
      <header>
        <span>Model response</span>
        <time>{formatTime(event.atMs)}</time>
      </header>
      {providerSummary === undefined ? null : (
        <details className="reasoning-note">
          <summary>Provider-returned reasoning summary</summary>
          <p>{providerSummary}</p>
        </details>
      )}
      {reasoningSummary === undefined ? null : (
        <details className="reasoning-note">
          <summary>Observable reasoning text</summary>
          <p>{reasoningSummary}</p>
        </details>
      )}
      <p className={finalResponse === undefined ? "empty-response" : "model-copy"}>
        {finalResponse ?? "Tool-directed turn; no model text was returned."}
      </p>
      {typeof usage?.outputTokens === "number" ? (
        <footer>{usage.outputTokens.toLocaleString()} output tokens</footer>
      ) : null}
    </article>
  );
}

function ToolCard({ call, playhead }: { call: ViewerToolCall; playhead: number }) {
  const completed = call.completedAtMs !== undefined && call.completedAtMs <= playhead;
  const status = completed ? call.status : "running";
  const elapsed = completed ? Math.max(0, call.completedAtMs! - call.startedAtMs) : undefined;
  return (
    <details className={`stream-card tool-card status-${status}`}>
      <summary>
        <span className="tool-status" aria-hidden="true" />
        <span>{call.name}</span>
        <time>{elapsed === undefined ? "running" : `${(elapsed / 1_000).toFixed(1)}s`}</time>
      </summary>
      <div className="tool-detail">
        <h4>Arguments</h4>
        <pre>{jsonText(call.arguments)}</pre>
        {!completed ? null : call.error === undefined ? (
          <>
            <h4>Output</h4>
            <pre>{jsonText(call.output ?? null)}</pre>
          </>
        ) : (
          <>
            <h4>Error</h4>
            <pre>{call.error}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function MilestoneCard({ event }: { event: ViewerEvent }) {
  const data = object(event.data);
  const label =
    event.kind === "stage.released"
      ? `Evidence stage ${String(data?.ordinal ?? "?")} released`
      : event.kind === "session.started"
        ? "Session opened"
        : event.kind === "session.state"
          ? `Session ${String(data?.state ?? "changed")}`
          : event.kind;
  return (
    <article className={`milestone-card category-${event.category}`}>
      <span>{label}</span>
      <time>{formatTime(event.atMs)}</time>
    </article>
  );
}

type LaneItem =
  | { kind: "event"; atMs: number; sequence: number; event: ViewerEvent }
  | { kind: "tool"; atMs: number; sequence: number; call: ViewerToolCall };

function AgentLane({
  run,
  agentId,
  playhead,
  filters,
  playing,
}: {
  run: ViewerRun;
  agentId: string;
  playhead: number;
  filters: ReadonlySet<ViewerEventCategory>;
  playing: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const agent = run.agents.find((candidate) => candidate.agentId === agentId)!;
  const items = useMemo(() => {
    const eventItems: LaneItem[] = run.events.flatMap((event) => {
      if (
        event.agentId !== agentId ||
        event.atMs > playhead ||
        !filters.has(event.category) ||
        (event.kind !== "model.response" &&
          event.kind !== "stage.released" &&
          !event.kind.startsWith("session."))
      ) {
        return [];
      }
      return [{ kind: "event", atMs: event.atMs, sequence: event.sequence, event }];
    });
    const toolItems: LaneItem[] = filters.has("tool")
      ? run.toolCalls
          .filter((call) => call.agentId === agentId && call.startedAtMs <= playhead)
          .map((call) => ({
            kind: "tool",
            atMs: call.startedAtMs,
            sequence: call.startedSequence,
            call,
          }))
      : [];
    return [...eventItems, ...toolItems].sort(
      (left, right) => left.atMs - right.atMs || left.sequence - right.sequence,
    );
  }, [agentId, filters, playhead, run.events, run.toolCalls]);
  useEffect(() => {
    if (playing) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items.length, playing]);
  return (
    <section className="agent-lane" data-agent={agentId}>
      <header className="lane-header">
        <span className="agent-mark" aria-hidden="true" />
        <div>
          <h2>{agentId}</h2>
          <p>{agent.actualModel ?? agent.requestedModel}</p>
        </div>
      </header>
      <div className="lane-stream" ref={scrollRef}>
        {items.length === 0 ? <p className="waiting-copy">Waiting for the playhead.</p> : null}
        {items.map((item) =>
          item.kind === "tool" ? (
            <ToolCard key={`tool-${item.sequence}`} call={item.call} playhead={playhead} />
          ) : item.event.kind === "model.response" ? (
            <ResponseCard key={`event-${item.sequence}`} event={item.event} />
          ) : (
            <MilestoneCard key={`event-${item.sequence}`} event={item.event} />
          ),
        )}
      </div>
    </section>
  );
}

function TeamRoom({ run, playhead }: { run: ViewerRun; playhead: number }) {
  const messages = run.teamMessages.filter((message) => message.atMs <= playhead);
  return (
    <section className="team-room">
      <header>
        <div>
          <span className="eyebrow">Shared channel</span>
          <h2>Team room</h2>
        </div>
        <span className="message-count">
          {messages.length} / {run.teamMessages.length}
        </span>
      </header>
      <div className="team-scroll">
        {messages.length === 0 ? (
          <p className="waiting-copy">No messages at this point in the run.</p>
        ) : (
          messages.map((message) => (
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
}

interface TextSpan {
  surface: string;
  wordIndex?: number;
}

function tokenize(value: string): TextSpan[] {
  const expression = /\p{L}+(?:['\u2019]\p{L}+)*/gu;
  const spans: TextSpan[] = [];
  let cursor = 0;
  let wordIndex = 0;
  for (const match of value.matchAll(expression)) {
    const index = match.index;
    if (index > cursor) spans.push({ surface: value.slice(cursor, index) });
    spans.push({ surface: match[0], wordIndex });
    wordIndex += 1;
    cursor = index + match[0].length;
  }
  if (cursor < value.length) spans.push({ surface: value.slice(cursor) });
  return spans;
}

function DecodePane({
  run,
  playhead,
  checkpoints,
  replayStatus,
}: {
  run: ViewerRun;
  playhead: number;
  checkpoints: readonly DecodeCheckpoint[];
  replayStatus: string;
}) {
  const [originId, setOriginId] = useState(run.origins[0]?.originId ?? "shared");
  const spans = useMemo(() => tokenize(run.ciphertext), [run.ciphertext]);
  const originCheckpoints = useMemo(
    () =>
      checkpoints
        .filter((checkpoint) => checkpoint.originId === originId)
        .sort((left, right) => left.atMs - right.atMs),
    [checkpoints, originId],
  );
  const visibleCheckpoints = originCheckpoints.filter((checkpoint) => checkpoint.atMs <= playhead);
  const active = visibleCheckpoints.at(-1);
  const wordState = useMemo(() => {
    const state = new Map<number, { candidate: string | null; state: DecodeWordState }>();
    for (const checkpoint of visibleCheckpoints) {
      if (checkpoint.status !== "ready") continue;
      for (const [index, word] of state) {
        const nextState =
          word.state === "newly-correct"
            ? "previously-correct"
            : word.state === "previously-correct"
              ? "previously-correct"
              : "unchanged";
        state.set(index, { ...word, state: nextState });
      }
      for (const delta of checkpoint.deltas ?? []) {
        state.set(delta.index, { candidate: delta.candidate, state: delta.state });
      }
    }
    return state;
  }, [visibleCheckpoints]);
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
            <select value={originId} onChange={(event) => setOriginId(event.target.value)}>
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
            {visibleCheckpoints.length}/{originCheckpoints.length}
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
      <div className="decoded-paper">
        {spans.map((span, index) => {
          if (span.wordIndex === undefined)
            return <React.Fragment key={index}>{span.surface}</React.Fragment>;
          const decoded = wordState.get(span.wordIndex);
          return (
            <span
              id={`decode-word-${String(span.wordIndex)}`}
              key={index}
              className={`decode-word state-${decoded?.state ?? "unchanged"}`}
              title={`Cipher: ${span.surface}${decoded === undefined ? "" : ` | Candidate: ${decoded.candidate ?? "missing"}`}`}
            >
              {decoded?.candidate ?? (decoded?.candidate === null ? "[missing]" : span.surface)}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function Timeline({
  run,
  playhead,
  setPlayhead,
  playing,
  setPlaying,
  speed,
  setSpeed,
  filters,
  toggleFilter,
  checkpoints,
}: {
  run: ViewerRun;
  playhead: number;
  setPlayhead: (value: number) => void;
  playing: boolean;
  setPlaying: (value: boolean) => void;
  speed: number;
  setSpeed: (value: number) => void;
  filters: ReadonlySet<ViewerEventCategory>;
  toggleFilter: (category: ViewerEventCategory) => void;
  checkpoints: readonly DecodeCheckpoint[];
}) {
  const times = useMemo(
    () =>
      [
        ...new Set([...run.events.map(({ atMs }) => atMs), ...checkpoints.map(({ atMs }) => atMs)]),
      ].sort((left, right) => left - right),
    [checkpoints, run.events],
  );
  const previous = () => {
    const target = [...times].reverse().find((time) => time < playhead - 1) ?? 0;
    setPlaying(false);
    setPlayhead(target);
  };
  const next = () => {
    const target = times.find((time) => time > playhead + 1) ?? run.durationMs;
    setPlaying(false);
    setPlayhead(target);
  };
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
        {run.events.map((event) =>
          filters.has(event.category) ? (
            <button
              aria-label={`${event.kind} at ${formatTime(event.atMs)}`}
              className={`event-tick category-${event.category}`}
              key={event.sequence}
              onClick={() => {
                setPlaying(false);
                setPlayhead(event.atMs);
              }}
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
            onClick={() => {
              setPlaying(false);
              setPlayhead(checkpoint.atMs);
            }}
            style={{ left: `${(checkpoint.atMs / Math.max(1, run.durationMs)) * 100}%` }}
          />
        ))}
        <input
          aria-label="Run playhead"
          type="range"
          min="0"
          max={Math.max(1, run.durationMs)}
          value={playhead}
          onChange={(event) => {
            setPlaying(false);
            setPlayhead(Number(event.target.value));
          }}
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
  const [checkpoints, setCheckpoints] = useState<DecodeCheckpoint[]>([]);
  const [replayStatus, setReplayStatus] = useState("preparing");
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(60);
  const [filters, setFilters] = useState<Set<ViewerEventCategory>>(() => new Set(CATEGORIES));
  const [mobilePanel, setMobilePanel] = useState("agents");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/run", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Viewer API returned ${String(response.status)}.`);
        setRun((await response.json()) as ViewerRun);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/decode/events");
    source.addEventListener("replay", (rawEvent) => {
      const event = JSON.parse((rawEvent as MessageEvent<string>).data) as DecodeStreamEvent;
      if (event.type === "checkpoint") {
        setCheckpoints((current) => {
          const next = current.filter(
            ({ checkpointId }) => checkpointId !== event.checkpoint.checkpointId,
          );
          return [...next, event.checkpoint];
        });
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
  }, []);

  useEffect(() => {
    if (!playing || run === undefined) return;
    let frame = 0;
    let previous = performance.now();
    const advance = (now: number) => {
      const elapsed = now - previous;
      previous = now;
      setPlayhead((current) => {
        const next = Math.min(run.durationMs, current + elapsed * speed);
        if (next >= run.durationMs) setPlaying(false);
        return next;
      });
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
        setPlaying(false);
        setPlayhead((current) => Math.max(0, current - 5_000));
      } else if (event.code === "ArrowRight") {
        setPlaying(false);
        setPlayhead((current) => Math.min(run.durationMs, current + 5_000));
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [run]);

  if (loadError !== undefined)
    return (
      <main className="fatal-screen">
        <h1>Replay unavailable</h1>
        <p>{loadError}</p>
      </main>
    );
  if (run === undefined)
    return (
      <main className="loading-screen">
        <span />
        <p>Opening the run record</p>
      </main>
    );

  const toggleFilter = (category: ViewerEventCategory) => {
    setFilters((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };
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
            {run.agents.map(({ agentId }) => (
              <AgentLane
                key={agentId}
                run={run}
                agentId={agentId}
                playhead={playhead}
                filters={filters}
                playing={playing}
              />
            ))}
          </div>
          <TeamRoom run={run} playhead={playhead} />
        </div>
        <DecodePane
          run={run}
          playhead={playhead}
          checkpoints={checkpoints}
          replayStatus={replayStatus}
        />
      </main>
      <Timeline
        run={run}
        playhead={playhead}
        setPlayhead={setPlayhead}
        playing={playing}
        setPlaying={setPlaying}
        speed={speed}
        setSpeed={setSpeed}
        filters={filters}
        toggleFilter={toggleFilter}
        checkpoints={checkpoints}
      />
    </div>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("Viewer root element is missing.");
createRoot(root).render(<App />);
