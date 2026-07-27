import { Lifecycle } from "./lifecycle.js";
import type { HarnessState } from "./types.js";

export class CommonBarrierCoordinator {
  readonly lifecycle = new Lifecycle();
  readonly #observed: HarnessState[] = ["PREPARED"];

  get observedStates(): readonly HarnessState[] {
    return this.#observed;
  }

  advance(next: HarnessState): void {
    this.lifecycle.transition(next);
    this.#observed.push(next);
  }
}
