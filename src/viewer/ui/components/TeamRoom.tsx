import { memo } from "react";

import type { ViewerTeamMessage } from "../../contracts.js";
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
