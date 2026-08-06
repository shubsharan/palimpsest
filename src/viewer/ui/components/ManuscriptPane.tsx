import { memo, useMemo, useRef, type ReactNode } from "react";

import type { ViewerRun } from "../../contracts.js";
import {
  decodeStateName,
  tokenizeLines,
  type DecodeSnapshot,
  type TextLine,
} from "../replay-index.js";
import { ManuscriptMap } from "./ManuscriptMap.js";

// One line of the manuscript. Every word carries a span so it can surface from
// ghosted cipher (the scraped-away under-text) to full ink as it is deciphered;
// plain runs (punctuation, spacing) are coalesced into a single text node.
const DecodedLine = memo(function DecodedLine({
  line,
  snapshot,
}: {
  line: TextLine;
  snapshot: DecodeSnapshot;
}) {
  const content: ReactNode[] = [];
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
    const ciphered = candidate === undefined && state === "unchanged";
    flush();
    // Glue an immediately following plain span (punctuation, spacing) onto the
    // word so it renders adjacent — but only when such a span exists.
    const following = line.spans[spanIndex + 1];
    const suffix =
      following !== undefined && following.wordIndex === undefined ? following.surface : "";
    if (suffix.length > 0) spanIndex += 1;
    content.push(
      <span
        id={`decode-word-${String(span.wordIndex)}`}
        key={span.wordIndex}
        className={`decode-word state-${ciphered ? "ciphered" : state}`}
        title={`Cipher: ${span.surface} | Candidate: ${candidate ?? "missing"}`}
      >
        {ciphered ? span.surface : (candidate ?? "[missing]")}
        {suffix}
      </span>,
    );
  }
  flush();
  return <div className="decode-paragraph">{content.length === 0 ? " " : content}</div>;
});

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

export const ManuscriptPane = memo(function ManuscriptPane({
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const jumpTo = (index: number) => {
    document.getElementById(`decode-word-${String(index)}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  const recovered =
    active?.matchedWords !== undefined && active.totalWords !== undefined
      ? `${active.matchedWords.toLocaleString()} / ${active.totalWords.toLocaleString()} words recovered`
      : "reading the ciphertext";
  return (
    <section className="manuscript">
      <div className="ms-readout">
        <div className="ms-lhs">
          <h2>Reconstruction</h2>
          {run.origins.length > 1 ? (
            <label className="origin-sel">
              origin
              <select value={originId} onChange={(event) => onOriginChange(event.target.value)}>
                {run.origins.map((origin) => (
                  <option key={origin.originId}>{origin.originId}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="ms-metric">{recovered}</div>
      </div>

      <div className="ms-caption">
        {active === undefined ? (
          <span className="ms-status">
            {replayStatus === "preparing"
              ? "Preparing solver checkpoints in the recorded sandbox…"
              : replayStatus === "complete"
                ? "Ciphertext at time zero — nothing published yet."
                : `Decode replay unavailable: ${replayStatus}`}
          </span>
        ) : active.status === "failed" ? (
          <span className="ms-status ms-error">Checkpoint unavailable. {active.error}</span>
        ) : (
          <>
            <code>{active.commit.slice(0, 8)}</code>
            <span className="ms-author">{active.author}</span>
            <span className="ms-subject">{active.subject || "published solver update"}</span>
            {(active.newlyCorrectRanges?.length ?? 0) > 0 ? (
              <nav className="ms-jump" aria-label="Newly decoded ranges">
                {active.newlyCorrectRanges!.slice(0, 6).map((range) => (
                  <button
                    type="button"
                    key={`${String(range.start)}-${String(range.end)}`}
                    onClick={() => jumpTo(range.start)}
                  >
                    words {range.start + 1}–{range.end + 1}
                  </button>
                ))}
              </nav>
            ) : null}
            <span className="ms-progress">
              checkpoint {visibleCheckpointCount}/{checkpointCount}
              {active.timing === "approximate" ? " · approx. time" : ""}
            </span>
          </>
        )}
      </div>

      <div className="manuscript-body">
        <DecodedPaper ciphertext={run.ciphertext} snapshot={snapshot} scrollRef={scrollRef} />
        <ManuscriptMap
          ciphertext={run.ciphertext}
          snapshot={snapshot}
          scrollRef={scrollRef}
          wordsLabel={recovered}
        />
      </div>
    </section>
  );
});
