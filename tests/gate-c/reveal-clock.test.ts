import { describe, expect, test } from "vitest";

import type { MonotonicClock } from "../../tools/gate-c/config.js";
import {
  runRevealPlan,
  type RevealEvent,
  type RevealSlot,
} from "../../tools/gate-c/reveal-runner.js";

class FakeClock implements MonotonicClock {
  currentMs = 1_000;

  nowMs(): number {
    return this.currentMs;
  }

  async waitUntil(targetMs: number): Promise<void> {
    this.currentMs = Math.max(this.currentMs, targetMs);
  }
}

const slots: RevealSlot[] = [
  { chapterIndex: 10, ordinal: 1, plannedOffsetMs: 0 },
  { chapterIndex: 11, ordinal: 2, plannedOffsetMs: 120_000 },
  { chapterIndex: 12, ordinal: 3, plannedOffsetMs: 240_000 },
];

describe("Gate C reveal clock", () => {
  test("persists each event before releasing its complete chapter", async () => {
    const actions: string[] = [];
    const events = await runRevealPlan(slots, {
      clock: new FakeClock(),
      persistEvent: async (event) => {
        actions.push(`persist:${event.ordinal}`);
      },
      releaseChapter: async (slot) => {
        actions.push(`release:${slot.ordinal}`);
      },
    });
    expect(actions).toEqual([
      "persist:1",
      "release:1",
      "persist:2",
      "release:2",
      "persist:3",
      "release:3",
    ]);
    expect(events.map((event) => event.observedOffsetMs)).toEqual([0, 120_000, 240_000]);
  });

  test("release timing is independent of callback duration", async () => {
    const clock = new FakeClock();
    const observed: RevealEvent[] = [];
    await runRevealPlan(slots, {
      clock,
      persistEvent: async (event) => {
        observed.push(event);
      },
      releaseChapter: async () => {
        clock.currentMs += 10_000;
      },
    });
    expect(observed.map((event) => event.observedOffsetMs)).toEqual([0, 120_000, 240_000]);
  });

  test("rejects gaps and decreasing offsets before any release", async () => {
    const releaseChapter = async () => {
      throw new Error("must not release");
    };
    await expect(
      runRevealPlan(
        [
          { chapterIndex: 10, ordinal: 1, plannedOffsetMs: 10 },
          { chapterIndex: 11, ordinal: 3, plannedOffsetMs: 5 },
        ],
        {
          clock: new FakeClock(),
          persistEvent: async () => {},
          releaseChapter,
        },
      ),
    ).rejects.toThrow("out of sequence");
  });
});
