import type { AgentId } from "./model.js";

export type ActivityKind = "stage-released" | "git-changed";

export interface ActivityEvent {
  sequence: number;
  kind: ActivityKind;
  occurredAtMs: number;
  agentId?: AgentId;
  detail: Readonly<Record<string, unknown>>;
}

export type ActivityWaitResult =
  | ActivityEvent
  | {
      ended: true;
      reason: string;
    };

interface ActivityInput {
  kind: ActivityKind;
  agentId?: AgentId;
  detail: Readonly<Record<string, unknown>>;
  occurredAtMs?: number;
}

interface Waiter {
  agentId: AgentId;
  afterSequence: number;
  resolve: (result: ActivityWaitResult) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

function isVisible(event: ActivityEvent, agentId: AgentId): boolean {
  return event.kind === "git-changed" || event.agentId === agentId;
}

export class ActivityBus {
  readonly #nowMs: () => number;
  readonly #events: ActivityEvent[] = [];
  readonly #waiters = new Set<Waiter>();
  #endedReason: string | undefined;

  constructor(nowMs: () => number = () => performance.now()) {
    this.#nowMs = nowMs;
  }

  get latestSequence(): number {
    return this.#events.at(-1)?.sequence ?? 0;
  }

  get events(): readonly ActivityEvent[] {
    return this.#events;
  }

  visibleAfter(agentId: AgentId, afterSequence: number): ActivityEvent[] {
    return this.#events.filter(
      (event) => event.sequence > afterSequence && isVisible(event, agentId),
    );
  }

  publish(input: ActivityInput): ActivityEvent {
    if (this.#endedReason !== undefined) {
      throw new Error("Cannot publish activity after the attempt ended.");
    }
    const common = {
      sequence: this.latestSequence + 1,
      kind: input.kind,
      occurredAtMs: input.occurredAtMs ?? this.#nowMs(),
      detail: input.detail,
    };
    const event: ActivityEvent =
      input.agentId === undefined ? common : { ...common, agentId: input.agentId };
    this.#events.push(event);
    for (const waiter of this.#waiters) {
      if (event.sequence > waiter.afterSequence && isVisible(event, waiter.agentId)) {
        this.#resolveWaiter(waiter, event);
      }
    }
    return event;
  }

  waitForVisible(
    agentId: AgentId,
    afterSequence: number,
    signal?: AbortSignal,
  ): Promise<ActivityWaitResult> {
    const existing = this.visibleAfter(agentId, afterSequence)[0];
    if (existing) return Promise.resolve(existing);
    if (this.#endedReason !== undefined) {
      return Promise.resolve({ ended: true, reason: this.#endedReason });
    }
    if (signal?.aborted) {
      return Promise.resolve({ ended: true, reason: "time-exhausted" });
    }
    return new Promise((resolve) => {
      const waiter: Waiter =
        signal === undefined
          ? { agentId, afterSequence, resolve }
          : { agentId, afterSequence, resolve, signal };
      if (signal !== undefined) {
        waiter.abort = () => {
          this.#resolveWaiter(waiter, { ended: true, reason: "time-exhausted" });
        };
        signal.addEventListener("abort", waiter.abort, { once: true });
      }
      this.#waiters.add(waiter);
    });
  }

  end(reason: string): void {
    if (this.#endedReason !== undefined) return;
    this.#endedReason = reason;
    for (const waiter of this.#waiters) {
      this.#resolveWaiter(waiter, { ended: true, reason });
    }
  }

  #resolveWaiter(waiter: Waiter, result: ActivityWaitResult): void {
    this.#waiters.delete(waiter);
    if (waiter.signal !== undefined && waiter.abort !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.abort);
    }
    waiter.resolve(result);
  }
}
