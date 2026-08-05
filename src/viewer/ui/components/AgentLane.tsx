import { memo, useEffect, useRef } from "react";

import { upperBound, type ViewerLaneIndex } from "../replay-index.js";
import { MilestoneCard } from "./MilestoneCard.js";
import { ResponseCard } from "./ResponseCard.js";
import { ToolCard } from "./ToolCard.js";

export const AgentLane = memo(function AgentLane({
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
