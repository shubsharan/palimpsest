import type { ActivityBus } from "./activity.js";
import type { AgentId } from "./model.js";

export type TeamChannelMode = "enabled" | "disabled";

export const TEAM_MESSAGE_MAX_CHARACTERS = 4_000;
export const TEAM_MESSAGE_PAGE_SIZE = 20;

export interface TeamMessage {
  sequence: number;
  author: AgentId;
  message: string;
  occurredAtMs: number;
}

export interface TeamMessagePage {
  messages: readonly TeamMessage[];
  latestSequence: number;
  nextSequence: number;
  hasMore: boolean;
}

export type TeamMessageObserver = (message: TeamMessage) => void | Promise<void>;

export class TeamChannel {
  readonly #activities: Readonly<Record<AgentId, ActivityBus>>;
  readonly #nowMs: () => number;
  readonly #observe: TeamMessageObserver;
  readonly #messages: TeamMessage[] = [];
  #posting: Promise<void> = Promise.resolve();

  constructor(options: {
    activities: Readonly<Record<AgentId, ActivityBus>>;
    nowMs: () => number;
    observe: TeamMessageObserver;
  }) {
    this.#activities = options.activities;
    this.#nowMs = options.nowMs;
    this.#observe = options.observe;
  }

  get latestSequence(): number {
    return this.#messages.at(-1)?.sequence ?? 0;
  }

  async post(author: AgentId, content: string): Promise<TeamMessage> {
    if (typeof content !== "string") {
      throw new Error("Team message must be text.");
    }
    const message = content.trim();
    if (message.length === 0) {
      throw new Error("Team message must contain non-whitespace text.");
    }
    if (message.length > TEAM_MESSAGE_MAX_CHARACTERS) {
      throw new Error(
        `Team message must contain at most ${String(TEAM_MESSAGE_MAX_CHARACTERS)} characters.`,
      );
    }
    const operation = this.#posting.then(async () => {
      const occurredAtMs = this.#nowMs();
      if (!Number.isFinite(occurredAtMs) || occurredAtMs < 0) {
        throw new Error("Team message time must be a finite non-negative number.");
      }
      const accepted: TeamMessage = {
        sequence: this.latestSequence + 1,
        author,
        message,
        occurredAtMs,
      };
      await this.#observe(accepted);
      this.#messages.push(accepted);
      for (const activity of Object.values(this.#activities)) {
        activity.publish({
          kind: "team-message",
          detail: { messageSequence: accepted.sequence, author },
          occurredAtMs,
        });
      }
      return accepted;
    });
    this.#posting = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  read(afterSequence: number): TeamMessagePage {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Team message cursor must be a non-negative safe integer.");
    }
    const unseen = this.#messages.filter((message) => message.sequence > afterSequence);
    const messages = unseen.slice(0, TEAM_MESSAGE_PAGE_SIZE);
    const nextSequence = messages.at(-1)?.sequence ?? afterSequence;
    return {
      messages,
      latestSequence: this.latestSequence,
      nextSequence,
      hasMore: unseen.length > messages.length,
    };
  }
}
