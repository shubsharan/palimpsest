export interface MonotonicClock {
  nowMs(): number;
  waitUntil(deadlineMs: number, signal: AbortSignal): Promise<boolean>;
}

export const systemMonotonicClock: MonotonicClock = {
  nowMs: () => performance.now(),
  waitUntil(deadlineMs, signal) {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(finish, Math.max(0, deadlineMs - performance.now()), true);
      const abort = () => {
        clearTimeout(timer);
        finish(false);
      };
      function finish(reached: boolean): void {
        signal.removeEventListener("abort", abort);
        resolve(reached);
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  },
};

export async function runRevealSchedule(options: {
  clock: MonotonicClock;
  startedAtMs: number;
  stageIntervalMs: number;
  stageCount: number;
  signal: AbortSignal;
  reveal: (ordinal: number) => Promise<void> | void;
}): Promise<void> {
  for (let ordinal = 2; ordinal <= options.stageCount; ordinal += 1) {
    const reached = await options.clock.waitUntil(
      options.startedAtMs + (ordinal - 1) * options.stageIntervalMs,
      options.signal,
    );
    if (!reached) return;
    await options.reveal(ordinal);
  }
}
