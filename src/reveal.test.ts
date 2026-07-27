import { describe, expect, it, vi } from "vitest";

import { runRevealSchedule, type MonotonicClock } from "./reveal.js";

class ControlledClock implements MonotonicClock {
  currentMs: number;
  readonly deadlines: number[] = [];

  constructor(currentMs: number) {
    this.currentMs = currentMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  waitUntil(deadlineMs: number, signal: AbortSignal): Promise<boolean> {
    this.deadlines.push(deadlineMs);
    if (signal.aborted) return Promise.resolve(false);
    this.currentMs = Math.max(this.currentMs, deadlineMs);
    return Promise.resolve(true);
  }
}

describe("reveal schedule", () => {
  it("releases later stages at monotonic interval boundaries", async () => {
    const clock = new ControlledClock(115);
    const reveal = vi.fn();

    await runRevealSchedule({
      clock,
      startedAtMs: 100,
      stageIntervalMs: 20,
      stageCount: 4,
      signal: new AbortController().signal,
      reveal,
    });

    expect(clock.deadlines).toEqual([120, 140, 160]);
    expect(reveal.mock.calls).toEqual([[2], [3], [4]]);
  });

  it("releases a stage immediately when the monotonic clock is exactly at its boundary", async () => {
    const clock = new ControlledClock(120);
    const reveal = vi.fn();

    await runRevealSchedule({
      clock,
      startedAtMs: 100,
      stageIntervalMs: 20,
      stageCount: 2,
      signal: new AbortController().signal,
      reveal,
    });

    expect(clock.deadlines).toEqual([120]);
    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith(2);
  });

  it("stops without revealing when cancellation interrupts a pending boundary", async () => {
    const controller = new AbortController();
    let requestedDeadline: number | undefined;
    const clock: MonotonicClock = {
      nowMs: () => 100,
      waitUntil(deadlineMs, signal) {
        requestedDeadline = deadlineMs;
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(false), { once: true });
        });
      },
    };
    const reveal = vi.fn();
    const scheduled = runRevealSchedule({
      clock,
      startedAtMs: 100,
      stageIntervalMs: 20,
      stageCount: 3,
      signal: controller.signal,
      reveal,
    });

    expect(requestedDeadline).toBe(120);
    controller.abort();
    await scheduled;

    expect(reveal).not.toHaveBeenCalled();
  });

  it("does not consult the system wall clock", async () => {
    const wallClock = vi.spyOn(Date, "now").mockReturnValueOnce(10_000).mockReturnValueOnce(1);
    const clock = new ControlledClock(100);

    await runRevealSchedule({
      clock,
      startedAtMs: 100,
      stageIntervalMs: 20,
      stageCount: 2,
      signal: new AbortController().signal,
      reveal: vi.fn(),
    });

    expect(wallClock).not.toHaveBeenCalled();
    wallClock.mockRestore();
  });
});
