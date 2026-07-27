import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AgentId } from "./config.js";

export interface ObservationEvent {
  sequence: number;
  atMs: number;
  kind: string;
  agentId?: AgentId;
  data: unknown;
}

const secretKey =
  /^(?:api[-_]?key|authorization|credential|password|secret|oracle|plaintext|expected(?:words?)?)$/i;

function redact(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = secretKey.test(key) ? "[REDACTED]" : redact(child, seen);
  }
  seen.delete(value);
  return result;
}

export class JsonlObservationLog {
  readonly path: string;
  readonly #nowMs: () => number;
  #sequence = 0;
  #pending: Promise<void> = Promise.resolve();

  constructor(path: string, nowMs: () => number = () => performance.now()) {
    this.path = path;
    this.#nowMs = nowMs;
  }

  append(kind: string, data: unknown, agentId?: AgentId): Promise<ObservationEvent> {
    let written: ObservationEvent | undefined;
    const operation = this.#pending.then(async () => {
      const common = {
        sequence: ++this.#sequence,
        atMs: this.#nowMs(),
        kind,
        data: redact(data, new WeakSet()),
      };
      written = agentId === undefined ? common : { ...common, agentId };
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(written)}\n`, "utf8");
    });
    this.#pending = operation;
    return operation.then(() => {
      if (!written) throw new Error("Observation append completed without a record.");
      return written;
    });
  }

  async flush(): Promise<void> {
    await this.#pending;
  }
}
