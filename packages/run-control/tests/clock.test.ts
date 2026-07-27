import { describe, expect, test } from "vitest";

import { AbsoluteSchedule, DeterministicClock, validateHarnessSchedule } from "../src/clock.js";

const schedule = {
  revealOffsetsMs: [10, 30],
  publicationOffsetsMs: [20, 55],
  pushCloseOffsetMs: 50,
  freezeOffsetMs: 60,
  finalizationOffsetMs: 80,
  toleranceMs: 2,
  stabilizationIntervalMs: 20,
} as const;

describe("deterministic monotonic clock", () => {
  test("advances to absolute barriers and never moves backwards", async () => {
    const clock = new DeterministicClock();
    await clock.waitUntil(10);
    expect(clock.nowMs()).toBe(10);
    await clock.waitUntil(25);
    expect(clock.nowMs()).toBe(25);
    await expect(clock.waitUntil(24)).rejects.toThrow(/backwards/);
  });

  test("executes reveal and publication from absolute offsets independent of agents", async () => {
    const clock = new DeterministicClock();
    const absolute = new AbsoluteSchedule(clock, schedule);

    const reveal = await absolute.waitFor({ kind: "reveal", ordinal: 1 });
    const publication = await absolute.waitFor({ kind: "publication", ordinal: 1 });
    const secondReveal = await absolute.waitFor({ kind: "reveal", ordinal: 2 });

    expect([
      reveal.actualOffsetMs,
      publication.actualOffsetMs,
      secondReveal.actualOffsetMs,
    ]).toEqual([10, 20, 30]);
    expect(absolute.observations).toHaveLength(3);
    await expect(absolute.waitFor({ kind: "reveal", ordinal: 1 })).rejects.toThrow(/already/);

    const concurrent = new AbsoluteSchedule(new DeterministicClock(), schedule);
    const first = concurrent.waitFor({ kind: "reveal", ordinal: 1 });
    await expect(concurrent.waitFor({ kind: "reveal", ordinal: 1 })).rejects.toThrow(/already/);
    await expect(first).resolves.toMatchObject({ actualOffsetMs: 10 });

    const epochClock = new DeterministicClock();
    epochClock.advanceTo(42);
    const fromLaunch = new AbsoluteSchedule(epochClock, schedule, 42);
    await expect(fromLaunch.waitFor({ kind: "reveal", ordinal: 1 })).resolves.toMatchObject({
      actualOffsetMs: 10,
      scheduledOffsetMs: 10,
    });
    expect(epochClock.nowMs()).toBe(52);
  });

  test("rejects invalid ordering, inadequate stabilization, and excessive drift", async () => {
    expect(() =>
      validateHarnessSchedule({
        ...schedule,
        revealOffsetsMs: [30, 10],
      }),
    ).toThrow(/strictly increasing/);
    expect(() =>
      validateHarnessSchedule({
        ...schedule,
        pushCloseOffsetMs: 45,
      }),
    ).toThrow(/stabilization/);
    expect(() =>
      validateHarnessSchedule({
        ...schedule,
        publicationOffsetsMs: [20, 50],
      }),
    ).toThrow(/after push close/);
    expect(() =>
      validateHarnessSchedule({
        ...schedule,
        publicationOffsetsMs: [20, 60],
      }),
    ).toThrow(/before freeze/);

    const clock = new DeterministicClock();
    clock.advanceTo(13);
    const absolute = new AbsoluteSchedule(clock, schedule);
    await expect(absolute.waitFor({ kind: "reveal", ordinal: 1 })).rejects.toThrow(/tolerance/);
  });
});
