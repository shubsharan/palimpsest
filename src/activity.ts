export type ActivityKind = "stage-released" | "git-changed";

export interface ActivityEvent {
  sequence: number;
  kind: ActivityKind;
  occurredAtMs: number;
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
  detail: Readonly<Record<string, unknown>>;
  occurredAtMs?: number;
}

interface Waiter {
  afterSequence: number;
  resolve: (result: ActivityWaitResult) => void;
  signal?: AbortSignal;
  abort?: () => void;
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

  after(afterSequence: number): ActivityEvent[] {
    return this.#events.filter((event) => event.sequence > afterSequence);
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
    this.#events.push(common);
    for (const waiter of this.#waiters) {
      if (common.sequence > waiter.afterSequence) {
        this.#resolveWaiter(waiter, common);
      }
    }
    return common;
  }

  waitFor(afterSequence: number, signal?: AbortSignal): Promise<ActivityWaitResult> {
    const existing = this.after(afterSequence)[0];
    if (existing) return Promise.resolve(existing);
    if (this.#endedReason !== undefined) {
      return Promise.resolve({ ended: true, reason: this.#endedReason });
    }
    if (signal?.aborted) {
      return Promise.resolve({ ended: true, reason: "time-exhausted" });
    }
    return new Promise((resolve) => {
      const waiter: Waiter =
        signal === undefined ? { afterSequence, resolve } : { afterSequence, resolve, signal };
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
