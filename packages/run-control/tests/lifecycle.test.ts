import { describe, expect, test } from "vitest";

import { CommonBarrierCoordinator } from "../src/coordinator.js";
import { DeterministicClock } from "../src/clock.js";
import { Lifecycle } from "../src/lifecycle.js";
import type { HarnessState } from "../src/types.js";

describe("harness lifecycle", () => {
  test("accepts the complete frozen path", () => {
    const lifecycle = new Lifecycle();
    for (const state of [
      "STARTING",
      "RUNNING",
      "PUSH_CLOSED",
      "DRAINING",
      "FROZEN",
      "FINALIZING",
      "SUBMITTED",
      "REPLAYED",
      "SCORED",
    ] as const) {
      expect(lifecycle.transition(state)).toBe(state);
    }
  });

  test("rejects skipped, repeated, and post-terminal transitions", () => {
    const lifecycle = new Lifecycle();
    expect(() => lifecycle.transition("RUNNING")).toThrow(/Illegal/);
    lifecycle.transition("INVALID");
    expect(() => lifecycle.transition("STARTING")).toThrow(/Illegal/);
  });

  test.each([
    "PREPARED",
    "STARTING",
    "RUNNING",
    "PUSH_CLOSED",
    "DRAINING",
    "FROZEN",
    "FINALIZING",
    "SUBMITTED",
    "REPLAYED",
  ] satisfies HarnessState[])("permits integrity invalidation from %s", (state) => {
    const lifecycle = new Lifecycle(state);
    expect(lifecycle.transition("INVALID")).toBe("INVALID");
    expect(() => lifecycle.transition("INVALID")).toThrow(/Illegal/);
  });

  test.each(["SCORED", "INVALID"] satisfies HarnessState[])(
    "keeps terminal state %s terminal",
    (state) => {
      const lifecycle = new Lifecycle(state);
      expect(() => lifecycle.transition("INVALID")).toThrow(/Illegal/);
    },
  );

  test("opens one common launch barrier only after all three agents arrive", async () => {
    const clock = new DeterministicClock();
    clock.advanceTo(42);
    const coordinator = new CommonBarrierCoordinator(["agent-1", "agent-2", "agent-3"], clock);
    coordinator.advance("STARTING");

    let released = false;
    const first = coordinator.arriveAtLaunch("agent-1").then((epoch) => {
      released = true;
      return epoch;
    });
    const second = coordinator.arriveAtLaunch("agent-2");
    await Promise.resolve();
    expect(released).toBe(false);
    const third = coordinator.arriveAtLaunch("agent-3");

    await expect(Promise.all([first, second, third])).resolves.toEqual([42, 42, 42]);
    expect(coordinator.advance("RUNNING")).toBe("RUNNING");
    expect(coordinator.launchEpochMs).toBe(42);
  });

  test("rejects unknown and duplicate barrier arrivals and running before release", async () => {
    const coordinator = new CommonBarrierCoordinator(["agent-1", "agent-2", "agent-3"]);
    coordinator.advance("STARTING");
    await expect(coordinator.arriveAtLaunch("other")).rejects.toThrow(/Unknown/);
    void coordinator.arriveAtLaunch("agent-1");
    await expect(coordinator.arriveAtLaunch("agent-1")).rejects.toThrow(/Duplicate/);
    expect(() => coordinator.advance("RUNNING")).toThrow(/barrier/);
  });
});
