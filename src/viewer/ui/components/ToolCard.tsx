import { memo, useState } from "react";

import type { ViewerToolCall, ViewerToolDetail } from "../../contracts.js";
import { jsonText } from "../format.js";

// Tool arguments and output can be large, so they are fetched lazily the first
// time a card is opened and cached by started-sequence for the life of the page.
const toolDetailCache = new Map<number, Promise<ViewerToolDetail>>();

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

export const ToolCard = memo(function ToolCard({
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
