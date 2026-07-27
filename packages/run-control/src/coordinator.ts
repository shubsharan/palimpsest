import type { MonotonicClock } from "./clock.js";
import { SystemMonotonicClock } from "./clock.js";
import { Lifecycle } from "./lifecycle.js";
import type { HarnessState } from "./types.js";

export class CommonBarrierCoordinator {
  readonly lifecycle = new Lifecycle();
  readonly #observed: HarnessState[] = ["PREPARED"];
  readonly #expectedAgents: Set<string>;
  readonly #arrivedAgents = new Set<string>();
  readonly #clock: MonotonicClock;
  readonly #launchPromise: Promise<number>;
  #releaseLaunch!: (epoch: number) => void;
  #launchEpochMs: number | null = null;

  constructor(
    expectedAgentIds: readonly string[] = [],
    clock: MonotonicClock = new SystemMonotonicClock(),
  ) {
    this.#expectedAgents = new Set(expectedAgentIds);
    if (this.#expectedAgents.size !== expectedAgentIds.length) {
      throw new Error("Common launch barrier agent identities must be unique.");
    }
    if (expectedAgentIds.length !== 0 && expectedAgentIds.length !== 3) {
      throw new Error("Palimpsest requires exactly three agents at the common launch barrier.");
    }
    this.#clock = clock;
    this.#launchPromise = new Promise((resolve) => {
      this.#releaseLaunch = resolve;
    });
  }

  get observedStates(): readonly HarnessState[] {
    return this.#observed;
  }

  get launchEpochMs(): number | null {
    return this.#launchEpochMs;
  }

  async arriveAtLaunch(agentId: string): Promise<number> {
    if (this.lifecycle.state !== "STARTING") {
      throw new Error("Agents may arrive only while the common launch barrier is STARTING.");
    }
    if (!this.#expectedAgents.has(agentId)) {
      throw new Error(`Unknown common launch barrier agent: ${agentId}.`);
    }
    if (this.#arrivedAgents.has(agentId)) {
      throw new Error(`Duplicate common launch barrier arrival: ${agentId}.`);
    }
    this.#arrivedAgents.add(agentId);
    if (this.#arrivedAgents.size === this.#expectedAgents.size) {
      this.#launchEpochMs = this.#clock.nowMs();
      this.#releaseLaunch(this.#launchEpochMs);
    }
    return this.#launchPromise;
  }

  advance(next: HarnessState): HarnessState {
    if (next === "RUNNING" && this.#expectedAgents.size > 0 && this.#launchEpochMs === null) {
      throw new Error("Cannot enter RUNNING before the common launch barrier releases.");
    }
    this.lifecycle.transition(next);
    this.#observed.push(next);
    return next;
  }
}
