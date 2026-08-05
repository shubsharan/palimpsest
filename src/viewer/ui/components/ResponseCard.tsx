import { memo } from "react";

import type { ViewerEvent } from "../../contracts.js";
import { formatTime } from "../format.js";

export const ResponseCard = memo(function ResponseCard({ event }: { event: ViewerEvent }) {
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
