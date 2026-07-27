import { describe, expect, test } from "vitest";

import { DeterministicClock } from "../src/clock.js";

describe("deterministic monotonic clock", () => {
  test("advances to absolute barriers and never moves backwards", async () => {
    const clock = new DeterministicClock();
    await clock.waitUntil(10);
    expect(clock.nowMs()).toBe(10);
    await clock.waitUntil(25);
    expect(clock.nowMs()).toBe(25);
    await expect(clock.waitUntil(24)).rejects.toThrow(/backwards/);
  });
});
