import { performance } from "node:perf_hooks";

import type { MonotonicClock } from "./config.js";

export class SystemMonotonicClock implements MonotonicClock {
  nowMs(): number {
    return performance.now();
  }

  async waitUntil(targetMs: number): Promise<void> {
    const delayMs = Math.max(0, targetMs - this.nowMs());
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
}
