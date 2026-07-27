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
}
