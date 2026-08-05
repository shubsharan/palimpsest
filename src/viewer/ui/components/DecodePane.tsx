import { memo, useMemo, type ReactNode } from "react";

import type { ViewerRun } from "../../contracts.js";
import { formatPercent } from "../format.js";
import {
  decodeStateName,
  tokenizeLines,
  type DecodeSnapshot,
  type TextLine,
} from "../replay-index.js";

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
    if (candidate === undefined && state === "unchanged") {
      plain += span.surface;
      continue;
    }
    flush();
    // Glue an immediately following plain span (punctuation, spacing) onto the
    // decoded word so it renders adjacent — but only when such a span exists.
    const following = line.spans[spanIndex + 1];
    const suffix =
      following !== undefined && following.wordIndex === undefined ? following.surface : "";
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
  return <div className="decode-paragraph">{content.length === 0 ? " " : content}</div>;
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

export const DecodePane = memo(function DecodePane({
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
          <span>Correct words</span>
          <strong className="word-total">
            {active === undefined
              ? "-- / --"
              : `${active.matchedWords?.toLocaleString() ?? "--"} / ${active.totalWords?.toLocaleString() ?? "--"}`}
          </strong>
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
