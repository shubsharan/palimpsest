import { memo } from "react";

import type { ViewerEvent } from "../../contracts.js";
import { formatTime } from "../format.js";

export const MilestoneCard = memo(function MilestoneCard({ event }: { event: ViewerEvent }) {
  const display = event.display;
  if (display?.type !== "milestone") return null;
  return (
    <article className={`milestone-card category-${event.category}`}>
      <span>{display.label}</span>
      <time>{formatTime(event.atMs)}</time>
    </article>
  );
});
