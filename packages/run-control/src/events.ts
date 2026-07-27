import { appendFile, readFile } from "node:fs/promises";

import { canonicalJsonBytes, sha256Hex } from "@palimpsest/contracts";

import type { RunEvent } from "./types.js";

export interface EventInput {
  producer: string;
  effectId: string;
  eventType: string;
  monotonicElapsedNs: string;
  payload: Record<string, unknown>;
}

export class EventChain {
  readonly #events: RunEvent[] = [];
  readonly #effects = new Map<string, Buffer>();

  constructor(
    readonly runId: string,
    readonly path?: string,
  ) {}

  get events(): readonly RunEvent[] {
    return this.#events;
  }

  get head(): string | null {
    return this.#events.at(-1)?.digest ?? null;
  }

  async append(input: EventInput): Promise<RunEvent> {
    const effectBytes = canonicalJsonBytes(input);
    const prior = this.#effects.get(input.effectId);
    if (prior) {
      if (!prior.equals(effectBytes)) {
        throw new Error(`Conflicting duplicate event effect: ${input.effectId}`);
      }
      return this.#events.find((event) => event.effectId === input.effectId)!;
    }
    const body = {
      schemaVersion: 1 as const,
      contractId: "run-event" as const,
      runId: this.runId,
      sequence: this.#events.length + 1,
      ...input,
      previousDigest: this.head,
    };
    const event: RunEvent = {
      ...body,
      digest: sha256Hex(canonicalJsonBytes(body)),
    };
    this.#effects.set(input.effectId, effectBytes);
    this.#events.push(event);
    if (this.path) {
      await appendFile(this.path, Buffer.concat([canonicalJsonBytes(event), Buffer.from("\n")]));
    }
    return event;
  }

  static verify(events: readonly RunEvent[]): void {
    let previousDigest: string | null = null;
    const effects = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (
        event.sequence !== index + 1 ||
        event.previousDigest !== previousDigest ||
        effects.has(event.effectId)
      ) {
        throw new Error("Run event sequence, predecessor, or effect identity is invalid.");
      }
      const { digest, ...body } = event;
      if (sha256Hex(canonicalJsonBytes(body)) !== digest) {
        throw new Error(`Run event digest mismatch at sequence ${event.sequence}.`);
      }
      effects.add(event.effectId);
      previousDigest = digest;
    }
  }

  static async read(path: string): Promise<RunEvent[]> {
    const source = await readFile(path, "utf8");
    const events = source
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent);
    EventChain.verify(events);
    return events;
  }

  static async resume(runId: string, path: string): Promise<EventChain> {
    const events = await EventChain.read(path);
    if (events.some((event) => event.runId !== runId)) {
      throw new Error("Cannot resume an event chain for a different run.");
    }
    const chain = new EventChain(runId, path);
    for (const event of events) {
      chain.#events.push(event);
      const { digest: _digest, contractId: _contractId, runId: _runId, ...input } = event;
      chain.#effects.set(
        event.effectId,
        canonicalJsonBytes({
          producer: input.producer,
          effectId: input.effectId,
          eventType: input.eventType,
          monotonicElapsedNs: input.monotonicElapsedNs,
          payload: input.payload,
        }),
      );
    }
    return chain;
  }
}
