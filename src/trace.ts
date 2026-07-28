import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isAgentId, type AgentId } from "./model.js";

export interface ObservationEvent {
  sequence: number;
  atMs: number;
  kind: string;
  agentId?: AgentId;
  data: unknown;
}

export interface TraceMetadata {
  schemaVersion: 1;
  startedAt: string;
}

interface ObservationClockOptions {
  startedAtMs?: number;
  nowMs?: () => number;
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

function metadataPathFor(tracePath: string): string {
  return join(dirname(tracePath), "trace.meta.json");
}

function requireMetadata(value: unknown, path: string): TraceMetadata {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (value as { startedAt?: unknown }).startedAt !== "string" ||
    !Number.isFinite(Date.parse((value as { startedAt: string }).startedAt))
  ) {
    throw new Error(`${path} does not contain valid trace metadata.`);
  }
  return value as TraceMetadata;
}

function requireEvent(
  value: unknown,
  expectedSequence: number,
  previousAtMs: number,
  path: string,
): ObservationEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} event ${expectedSequence} must be an object.`);
  }
  const event = value as Partial<ObservationEvent>;
  if (event.sequence !== expectedSequence) {
    throw new Error(
      `${path} event ${expectedSequence} has sequence ${String(event.sequence)} instead of ${expectedSequence}.`,
    );
  }
  if (
    typeof event.atMs !== "number" ||
    !Number.isFinite(event.atMs) ||
    event.atMs < 0 ||
    event.atMs < previousAtMs
  ) {
    throw new Error(`${path} event ${expectedSequence} has a regressing or invalid atMs.`);
  }
  if (typeof event.kind !== "string" || event.kind.length === 0 || !("data" in event)) {
    throw new Error(`${path} event ${expectedSequence} is missing kind or data.`);
  }
  if (event.agentId !== undefined && !isAgentId(event.agentId)) {
    throw new Error(`${path} event ${expectedSequence} has an invalid agentId.`);
  }
  return event as ObservationEvent;
}

async function readExistingEvents(path: string): Promise<readonly ObservationEvent[]> {
  const source = await readFile(path, "utf8");
  if (source.length === 0) return [];
  const lines = source.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const events: ObservationEvent[] = [];
  let previousAtMs = 0;
  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      throw new Error(`${path} contains an empty record at sequence ${index + 1}.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${path} event ${index + 1} is not valid JSON: ${detail}`);
    }
    const event = requireEvent(parsed, index + 1, previousAtMs, path);
    previousAtMs = event.atMs;
    events.push(event);
  }
  return events;
}

export class JsonlObservationLog {
  readonly path: string;
  readonly metadataPath: string;
  readonly #nowMs: () => number;
  #sequence: number;
  #lastAtMs: number;
  #pending: Promise<void> = Promise.resolve();

  private constructor(options: {
    path: string;
    metadataPath: string;
    nowMs: () => number;
    sequence: number;
    lastAtMs: number;
  }) {
    this.path = options.path;
    this.metadataPath = options.metadataPath;
    this.#nowMs = options.nowMs;
    this.#sequence = options.sequence;
    this.#lastAtMs = options.lastAtMs;
  }

  static async create(
    path: string,
    options: ObservationClockOptions = {},
  ): Promise<JsonlObservationLog> {
    const metadataPath = metadataPathFor(path);
    const startedAtMs = options.startedAtMs ?? Date.now();
    if (!Number.isFinite(startedAtMs)) {
      throw new Error("Trace clock origin must be finite.");
    }
    const metadata: TraceMetadata = {
      schemaVersion: 1,
      startedAt: new Date(startedAtMs).toISOString(),
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await writeFile(path, "", { encoding: "utf8", flag: "wx" });
    } catch (error) {
      await rm(metadataPath, { force: true });
      throw error;
    }
    return new JsonlObservationLog({
      path,
      metadataPath,
      nowMs: options.nowMs ?? (() => Date.now() - startedAtMs),
      sequence: 0,
      lastAtMs: 0,
    });
  }

  static async open(
    path: string,
    options: { nowEpochMs?: () => number } = {},
  ): Promise<JsonlObservationLog> {
    const metadataPath = metadataPathFor(path);
    let metadataValue: unknown;
    try {
      metadataValue = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${metadataPath} is not valid JSON: ${detail}`);
    }
    const metadata = requireMetadata(metadataValue, metadataPath);
    const startedAtMs = Date.parse(metadata.startedAt);
    const events = await readExistingEvents(path);
    const last = events.at(-1);
    return new JsonlObservationLog({
      path,
      metadataPath,
      nowMs: () => (options.nowEpochMs ?? Date.now)() - startedAtMs,
      sequence: last?.sequence ?? 0,
      lastAtMs: last?.atMs ?? 0,
    });
  }

  append(kind: string, data: unknown, agentId?: AgentId): Promise<ObservationEvent> {
    let written: ObservationEvent | undefined;
    const operation = this.#pending.then(async () => {
      const observedAtMs = this.#nowMs();
      if (!Number.isFinite(observedAtMs)) {
        throw new Error("Observation clock returned a non-finite value.");
      }
      const atMs = Math.max(0, this.#lastAtMs, observedAtMs);
      const common = {
        sequence: this.#sequence + 1,
        atMs,
        kind,
        data: redact(data, new WeakSet()),
      };
      written = agentId === undefined ? common : { ...common, agentId };
      await appendFile(this.path, `${JSON.stringify(written)}\n`, "utf8");
      this.#sequence = written.sequence;
      this.#lastAtMs = written.atMs;
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
