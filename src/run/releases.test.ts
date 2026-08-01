import { describe, expect, it, vi } from "vitest";

import { runRevealSchedule, type MonotonicClock } from "./releases.js";

const RELEASE_OFFSETS_MS = [0, 300_000, 600_000, 1_200_000, 1_800_000, 2_400_000];

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
  it("releases later stages at the exact six declared offsets", async () => {
    const clock = new ControlledClock(115);
    const reveal = vi.fn();

    await runRevealSchedule({
      clock,
      startedAtMs: 100,
      releaseOffsetsMs: RELEASE_OFFSETS_MS,
      signal: new AbortController().signal,
      reveal,
    });

    expect(clock.deadlines).toEqual([300_100, 600_100, 1_200_100, 1_800_100, 2_400_100]);
    expect(reveal.mock.calls).toEqual([[2], [3], [4], [5], [6]]);
  });

  it("releases a stage immediately when the monotonic clock is exactly at its boundary", async () => {
    const clock = new ControlledClock(300_100);
    const reveal = vi.fn();

    await runRevealSchedule({
      clock,
      startedAtMs: 100,
      releaseOffsetsMs: [0, 300_000],
      signal: new AbortController().signal,
      reveal,
    });

    expect(clock.deadlines).toEqual([300_100]);
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
      releaseOffsetsMs: [0, 300_000, 600_000],
      signal: controller.signal,
      reveal,
    });

    expect(requestedDeadline).toBe(300_100);
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
      releaseOffsetsMs: [0, 300_000],
      signal: new AbortController().signal,
      reveal: vi.fn(),
    });

    expect(wallClock).not.toHaveBeenCalled();
    wallClock.mockRestore();
  });

  it.each([[[]], [[1]], [[0, 0]], [[0, -1]], [[0, 1.5]]])(
    "rejects an invalid offset vector %j",
    async (releaseOffsetsMs) => {
      await expect(
        runRevealSchedule({
          clock: new ControlledClock(0),
          startedAtMs: 0,
          releaseOffsetsMs,
          signal: new AbortController().signal,
          reveal: vi.fn(),
        }),
      ).rejects.toThrow("Release offsets must start at zero and increase as safe integers.");
    },
  );
});
