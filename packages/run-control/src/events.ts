import { open, readFile } from "node:fs/promises";

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
  #pending: Promise<void> = Promise.resolve();
  #durabilityFailure: Error | null = null;

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
    const operation = this.#pending.then(() => this.#appendSerial(input));
    this.#pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #appendSerial(input: EventInput): Promise<RunEvent> {
    if (this.#durabilityFailure) {
      throw new Error("Run event chain is unavailable after a durability failure.", {
        cause: this.#durabilityFailure,
      });
    }
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
    if (this.path) {
      const handle = await open(this.path, "a", 0o600);
      try {
        await handle.appendFile(Buffer.concat([canonicalJsonBytes(event), Buffer.from("\n")]));
        await handle.sync();
      } catch (error) {
        this.#durabilityFailure =
          error instanceof Error ? error : new Error("Unknown event durability failure.");
        throw error;
      } finally {
        await handle.close();
      }
    }
    this.#effects.set(input.effectId, effectBytes);
    this.#events.push(event);
    return event;
  }

  static verify(events: readonly RunEvent[]): void {
    let previousDigest: string | null = null;
    let previousElapsedNs = -1n;
    const effects = new Set<string>();
    for (const [index, event] of events.entries()) {
      if (event.sequence !== index + 1) {
        throw new Error(`Run event sequence gap or reordering at position ${index + 1}.`);
      }
      if (event.previousDigest !== previousDigest) {
        throw new Error(`Run event predecessor mismatch at sequence ${event.sequence}.`);
      }
      if (effects.has(event.effectId)) {
        throw new Error(`Run event effect identity is duplicated: ${event.effectId}.`);
      }
      if (!/^(0|[1-9][0-9]*)$/.test(event.monotonicElapsedNs)) {
        throw new Error(`Run event monotonic time is invalid at sequence ${event.sequence}.`);
      }
      const elapsedNs = BigInt(event.monotonicElapsedNs);
      if (elapsedNs < previousElapsedNs) {
        throw new Error(`Run event monotonic time regressed at sequence ${event.sequence}.`);
      }
      const { digest, ...body } = event;
      if (sha256Hex(canonicalJsonBytes(body)) !== digest) {
        throw new Error(`Run event digest mismatch at sequence ${event.sequence}.`);
      }
      effects.add(event.effectId);
      previousDigest = digest;
      previousElapsedNs = elapsedNs;
    }
  }

  static async read(path: string): Promise<RunEvent[]> {
    const source = await readFile(path);
    if (source.byteLength === 0) return [];
    if (source.at(-1) !== 0x0a) {
      throw new Error("Run event log has a torn final event.");
    }
    const lines = source.toString("utf8").slice(0, -1).split("\n");
    if (lines.some((line) => line.length === 0)) {
      throw new Error("Run event log contains an empty record.");
    }
    const events = lines.map((line, index) => {
      try {
        return JSON.parse(line) as RunEvent;
      } catch (error) {
        throw new Error(`Run event ${index + 1} is not valid JSON.`, { cause: error });
      }
    });
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
