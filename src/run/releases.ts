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
  releaseOffsetsMs: readonly number[];
  signal: AbortSignal;
  reveal: (ordinal: number) => Promise<void> | void;
}): Promise<void> {
  if (
    options.releaseOffsetsMs.length < 2 ||
    options.releaseOffsetsMs[0] !== 0 ||
    options.releaseOffsetsMs.some(
      (offset, index) =>
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        (index > 0 && offset <= options.releaseOffsetsMs[index - 1]!),
    )
  ) {
    throw new Error("Release offsets must start at zero and increase as safe integers.");
  }
  for (let index = 1; index < options.releaseOffsetsMs.length; index += 1) {
    const reached = await options.clock.waitUntil(
      options.startedAtMs + options.releaseOffsetsMs[index]!,
      options.signal,
    );
    if (!reached) return;
    await options.reveal(index + 1);
  }
}
