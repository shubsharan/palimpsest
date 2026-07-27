import { describe, expect, test } from "vitest";

import { Lifecycle } from "../src/lifecycle.js";

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
});
