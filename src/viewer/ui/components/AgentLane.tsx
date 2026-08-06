import { memo, useEffect, useRef, type CSSProperties } from "react";

import type { ViewerSessionUsage } from "../../contracts.js";
import { agentAccent } from "../constants.js";
import { upperBound, type ViewerLaneIndex } from "../replay-index.js";
import { MilestoneCard } from "./MilestoneCard.js";
import { ResponseCard } from "./ResponseCard.js";
import { ToolCard } from "./ToolCard.js";

export const AgentLane = memo(function AgentLane({
  lane,
  session,
  boundaryTime,
  playing,
}: {
  lane: ViewerLaneIndex;
  session: ViewerSessionUsage | undefined;
  boundaryTime: number;
  playing: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleCount = upperBound(lane.itemTimes, boundaryTime);
  useEffect(() => {
    if (playing) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [visibleCount, playing]);
  return (
    <section
      className="agent-lane"
      style={{ "--agent-accent": agentAccent(lane.agentId) } as CSSProperties}
    >
      <header className="lane-header">
        <div className="lane-id">
          <span className="agent-mark" aria-hidden="true" />
          <h2>{lane.agentId}</h2>
        </div>
        <p className="lane-model">{lane.model}</p>
        {session === undefined ? null : (
          <p className="lane-badge">
            {session.state.replace(/-/g, " ")}
            {session.outputTokens > 0 ? ` · ${Math.round(session.outputTokens / 1000)}k tok` : ""}
          </p>
        )}
      </header>
      <div className="lane-stream" ref={scrollRef}>
        {visibleCount === 0 ? <p className="waiting-copy">waiting…</p> : null}
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
