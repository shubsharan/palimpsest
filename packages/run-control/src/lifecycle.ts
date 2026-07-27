import type { HarnessState } from "./types.js";

const nextStates: Record<HarnessState, readonly HarnessState[]> = {
  PREPARED: ["STARTING", "INVALID"],
  STARTING: ["RUNNING", "INVALID"],
  RUNNING: ["PUSH_CLOSED", "INVALID"],
  PUSH_CLOSED: ["DRAINING", "INVALID"],
  DRAINING: ["FROZEN", "INVALID"],
  FROZEN: ["FINALIZING", "INVALID"],
  FINALIZING: ["SUBMITTED", "INVALID"],
  SUBMITTED: ["REPLAYED", "INVALID"],
  REPLAYED: ["SCORED", "INVALID"],
  SCORED: [],
  INVALID: [],
};

export class Lifecycle {
  #state: HarnessState;

  constructor(initial: HarnessState = "PREPARED") {
    this.#state = initial;
  }

  get state(): HarnessState {
    return this.#state;
  }

  transition(next: HarnessState): HarnessState {
    if (!nextStates[this.#state].includes(next)) {
      throw new Error(`Illegal harness lifecycle transition: ${this.#state} -> ${next}`);
    }
    this.#state = next;
    return next;
  }
}
