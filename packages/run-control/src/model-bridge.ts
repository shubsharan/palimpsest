import {
  FIXTURE_ADAPTER_ID,
  assertAdapterAuthorized,
  type OfflineHarnessAuthorization,
} from "../../../tools/harness/config.js";
import { spawn } from "node:child_process";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import {
  agentBridgeEventTypes,
  type AgentBridgeEvent,
  type BridgeLimits,
  type BridgeMeasuredUsage,
  type BridgeResourceUsage,
} from "./types.js";

export interface AdapterSelection {
  adapterId: string;
  authorization?: OfflineHarnessAuthorization;
}

export function authorizeAdapter(selection: AdapterSelection): void {
  assertAdapterAuthorized(selection.adapterId, selection.authorization);
}

export function isOfflineFixtureAdapter(adapterId: string): boolean {
  return adapterId === FIXTURE_ADAPTER_ID;
}

export interface BridgeProcessResult {
  events: AgentBridgeEvent[];
  stderr: string;
  exitCode: number;
  declaredFiles: string[];
  measuredUsage: BridgeMeasuredUsage;
  reportedResourceUsage: BridgeResourceUsage;
}

const eventKeys = new Set([
  "schemaVersion",
  "runId",
  "agentId",
  "invocationId",
  "ordinal",
  "type",
  "payload",
]);
const eventTypes = new Set<string>(agentBridgeEventTypes);

function assertSafeRelativePath(path: unknown): asserts path is string {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Fixture adapter emitted an unsafe file path.");
  }
}

function validateEvent(
  value: unknown,
  expected: { runId: string; agentId: string; invocationId: string; ordinal: number },
): AgentBridgeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture adapter emitted a non-object NDJSON event.");
  }
  const event = value as Record<string, unknown>;
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : null;
  if (
    Object.keys(event).some((key) => !eventKeys.has(key)) ||
    event.schemaVersion !== 1 ||
    event.runId !== expected.runId ||
    event.agentId !== expected.agentId ||
    event.invocationId !== expected.invocationId ||
    event.ordinal !== expected.ordinal ||
    typeof event.type !== "string" ||
    !eventTypes.has(event.type) ||
    !payload ||
    "reasoning" in event ||
    "chainOfThought" in event ||
    "reasoning" in payload ||
    "chainOfThought" in payload
  ) {
    throw new Error(`Fixture adapter emitted an invalid event at ordinal ${expected.ordinal}.`);
  }
  canonicalJsonBytes(value);
  return value as AgentBridgeEvent;
}

const defaultLimits: BridgeLimits = {
  maxStdoutBytes: 16 * 1024 * 1024,
  maxStderrBytes: 4 * 1024 * 1024,
  maxEvents: 100_000,
  maxCpuMs: Number.MAX_SAFE_INTEGER,
  maxMemoryBytes: Number.MAX_SAFE_INTEGER,
  maxDiskBytes: Number.MAX_SAFE_INTEGER,
};

function resolveLimits(overrides: Partial<BridgeLimits> | undefined): BridgeLimits {
  const limits = { ...defaultLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Bridge limit ${name} must be a non-negative safe integer.`);
    }
  }
  return limits;
}

function collectDeclaredFiles(events: readonly AgentBridgeEvent[]): string[] {
  const written = new Set<string>();
  const declared = new Set<string>();
  for (const event of events) {
    if (event.type === "file.written") {
      assertSafeRelativePath(event.payload.path);
      written.add(event.payload.path);
    }
    if (event.type === "file.declared") {
      if (!Array.isArray(event.payload.paths)) {
        throw new Error("Fixture adapter file.declared payload must contain paths.");
      }
      for (const path of event.payload.paths) {
        assertSafeRelativePath(path);
        if (declared.has(path)) {
          throw new Error(`Fixture adapter declared a duplicate file: ${path}.`);
        }
        declared.add(path);
      }
    }
  }
  const undeclared = [...written].filter((path) => !declared.has(path));
  if (undeclared.length > 0) {
    throw new Error(`Fixture adapter wrote undeclared files: ${undeclared.join(", ")}.`);
  }
  return [...declared].sort();
}

function collectResourceUsage(
  events: readonly AgentBridgeEvent[],
  limits: BridgeLimits,
): BridgeResourceUsage {
  const usage: BridgeResourceUsage = { cpuMs: 0, memoryBytes: 0, diskBytes: 0 };
  for (const event of events) {
    if (event.type !== "resource.usage") continue;
    for (const key of ["cpuMs", "memoryBytes", "diskBytes"] as const) {
      const value = event.payload[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Fixture adapter emitted invalid ${key} resource usage.`);
      }
      usage[key] = Math.max(usage[key], value);
    }
  }
  if (usage.cpuMs > limits.maxCpuMs) throw new Error("Fixture adapter exceeded its CPU quota.");
  if (usage.memoryBytes > limits.maxMemoryBytes) {
    throw new Error("Fixture adapter exceeded its memory quota.");
  }
  if (usage.diskBytes > limits.maxDiskBytes) {
    throw new Error("Fixture adapter exceeded its disk quota.");
  }
  return usage;
}

export async function runBridgeProcess(options: {
  command: string;
  args: string[];
  adapterId: string;
  runId: string;
  agentId: string;
  invocationId: string;
  timeoutMs: number;
  authorization?: OfflineHarnessAuthorization;
  limits?: Partial<BridgeLimits>;
}): Promise<BridgeProcessResult> {
  authorizeAdapter(options);
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Fixture adapter timeout must be a positive safe integer.");
  }
  const limits = resolveLimits(options.limits);
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(options.command, options.args, {
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | null = null;
    let settled = false;
    const failAndKill = (error: Error) => {
      if (!failure) failure = error;
      child.kill("SIGKILL");
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > limits.maxStdoutBytes) {
        failAndKill(new Error("Fixture adapter exceeded its stdout quota."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > limits.maxStderrBytes) {
        failAndKill(new Error("Fixture adapter exceeded its stderr quota."));
        return;
      }
      stderr.push(chunk);
    });
    const timer = setTimeout(() => {
      failAndKill(new Error(`Fixture adapter timed out after ${options.timeoutMs} ms.`));
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try {
        if (failure) throw failure;
        if (signal) {
          throw new Error(`Fixture adapter terminated by ${signal}.`);
        }
        if (code !== 0) {
          throw new Error(
            `Fixture adapter exited ${String(code)}: ${Buffer.concat(stderr).toString("utf8")}`,
          );
        }
        const source = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdout));
        if (!source.endsWith("\n")) {
          throw new Error("Fixture adapter emitted a partial final NDJSON event.");
        }
        const lines = source.slice(0, -1).split("\n");
        if (lines.some((line) => line.length === 0)) {
          throw new Error("Fixture adapter emitted an empty NDJSON record.");
        }
        if (lines.length > limits.maxEvents) {
          throw new Error("Fixture adapter exceeded its event quota.");
        }
        const events = lines.map((line, index) =>
          validateEvent(JSON.parse(line), {
            runId: options.runId,
            agentId: options.agentId,
            invocationId: options.invocationId,
            ordinal: index + 1,
          }),
        );
        const terminals = events.filter((event) => event.type === "worker.completed");
        if (terminals.length !== 1 || events.at(-1)?.type !== "worker.completed") {
          throw new Error("Fixture adapter must emit exactly one terminal worker.completed event.");
        }
        const declaredFiles = collectDeclaredFiles(events);
        const reportedResourceUsage = collectResourceUsage(events, limits);
        resolve({
          events,
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode: code ?? 0,
          declaredFiles,
          measuredUsage: {
            wallTimeMs: performance.now() - startedAt,
            stdoutBytes,
            stderrBytes,
            eventCount: events.length,
          },
          reportedResourceUsage,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
