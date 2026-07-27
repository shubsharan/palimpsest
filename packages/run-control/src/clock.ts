import type { HarnessSchedule, ScheduleBoundary, ScheduleObservation } from "./types.js";

export interface MonotonicClock {
  nowMs(): number;
  waitUntil(targetMs: number): Promise<void>;
}

export class SystemMonotonicClock implements MonotonicClock {
  readonly #epoch = process.hrtime.bigint();

  nowMs(): number {
    return Number(process.hrtime.bigint() - this.#epoch) / 1_000_000;
  }

  async waitUntil(targetMs: number): Promise<void> {
    const delay = Math.max(0, targetMs - this.nowMs());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

export class DeterministicClock implements MonotonicClock {
  #now = 0;

  nowMs(): number {
    return this.#now;
  }

  async waitUntil(targetMs: number): Promise<void> {
    if (targetMs < this.#now) {
      throw new Error("Deterministic clock cannot move backwards.");
    }
    this.#now = targetMs;
  }

  advanceTo(targetMs: number): void {
    if (targetMs < this.#now) {
      throw new Error("Deterministic clock cannot move backwards.");
    }
    this.#now = targetMs;
  }

  advanceBy(deltaMs: number): void {
    if (deltaMs < 0) {
      throw new Error("Deterministic clock cannot move backwards.");
    }
    this.#now += deltaMs;
  }
}

function assertIncreasing(name: string, values: readonly number[]): void {
  for (const [index, value] of values.entries()) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} offsets must be non-negative safe integers.`);
    }
    if (index > 0 && value <= values[index - 1]!) {
      throw new Error(`${name} offsets must be strictly increasing.`);
    }
  }
}

export function validateHarnessSchedule(schedule: HarnessSchedule): void {
  assertIncreasing("Reveal", schedule.revealOffsetsMs);
  assertIncreasing("Publication", schedule.publicationOffsetsMs);
  for (const [name, value] of [
    ["push close", schedule.pushCloseOffsetMs],
    ["freeze", schedule.freezeOffsetMs],
    ["finalization", schedule.finalizationOffsetMs],
    ["tolerance", schedule.toleranceMs],
    ["stabilization", schedule.stabilizationIntervalMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Harness ${name} must be a non-negative safe integer.`);
    }
  }
  if (
    schedule.pushCloseOffsetMs >= schedule.freezeOffsetMs ||
    schedule.freezeOffsetMs >= schedule.finalizationOffsetMs
  ) {
    throw new Error("Push close, freeze, and finalization offsets must be strictly increasing.");
  }
  const finalReveal = schedule.revealOffsetsMs.at(-1) ?? 0;
  if (finalReveal > schedule.pushCloseOffsetMs - schedule.stabilizationIntervalMs) {
    throw new Error("Final reveal does not leave the required stabilization interval.");
  }
}

function boundaryKey(boundary: ScheduleBoundary): string {
  return "ordinal" in boundary ? `${boundary.kind}:${boundary.ordinal}` : boundary.kind;
}

function boundaryOffset(schedule: HarnessSchedule, boundary: ScheduleBoundary): number {
  if (boundary.kind === "reveal" || boundary.kind === "publication") {
    if (!Number.isSafeInteger(boundary.ordinal) || boundary.ordinal < 1) {
      throw new Error("Schedule boundary ordinal must be a positive integer.");
    }
    const offsets =
      boundary.kind === "reveal" ? schedule.revealOffsetsMs : schedule.publicationOffsetsMs;
    const offset = offsets[boundary.ordinal - 1];
    if (offset === undefined) {
      throw new Error(`Unknown ${boundary.kind} schedule ordinal ${boundary.ordinal}.`);
    }
    return offset;
  }
  if (boundary.kind === "push-close") return schedule.pushCloseOffsetMs;
  if (boundary.kind === "freeze") return schedule.freezeOffsetMs;
  return schedule.finalizationOffsetMs;
}

export class AbsoluteSchedule {
  readonly #observations: ScheduleObservation[] = [];
  readonly #claimed = new Set<string>();

  constructor(
    readonly clock: MonotonicClock,
    readonly schedule: HarnessSchedule,
  ) {
    validateHarnessSchedule(schedule);
  }

  get observations(): readonly ScheduleObservation[] {
    return this.#observations;
  }

  async waitFor(boundary: ScheduleBoundary): Promise<ScheduleObservation> {
    const key = boundaryKey(boundary);
    if (this.#claimed.has(key)) {
      throw new Error(`Schedule boundary ${key} already completed.`);
    }
    this.#claimed.add(key);
    const scheduledOffsetMs = boundaryOffset(this.schedule, boundary);
    const before = this.clock.nowMs();
    if (before > scheduledOffsetMs + this.schedule.toleranceMs) {
      throw new Error(`Schedule boundary ${key} exceeded its declared tolerance.`);
    }
    if (before < scheduledOffsetMs) {
      await this.clock.waitUntil(scheduledOffsetMs);
    }
    const actualOffsetMs = this.clock.nowMs();
    const driftMs = actualOffsetMs - scheduledOffsetMs;
    if (Math.abs(driftMs) > this.schedule.toleranceMs) {
      throw new Error(`Schedule boundary ${key} exceeded its declared tolerance.`);
    }
    const observation = {
      boundary,
      scheduledOffsetMs,
      actualOffsetMs,
      driftMs,
    };
    this.#observations.push(observation);
    return observation;
  }
}
