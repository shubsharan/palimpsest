import { memo, type CSSProperties } from "react";

import type { ViewerTeamMessage } from "../../contracts.js";
import { agentAccent } from "../constants.js";
import { formatTime } from "../format.js";

export const TeamRoom = memo(function TeamRoom({
  messages,
  visibleCount,
}: {
  messages: readonly ViewerTeamMessage[];
  visibleCount: number;
}) {
  return (
    <section className="team-room">
      <header className="team-head">
        <h2>Team room</h2>
        <span className="team-count">
          {visibleCount} of {messages.length}
        </span>
      </header>
      <div className="team-scroll">
        {visibleCount === 0 ? (
          <p className="waiting-copy">waiting…</p>
        ) : (
          messages.slice(0, visibleCount).map((message) => (
            <article
              key={message.sequence}
              style={{ "--agent-accent": agentAccent(message.author) } as CSSProperties}
            >
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
