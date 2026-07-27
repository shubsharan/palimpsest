import {
  FIXTURE_ADAPTER_ID,
  assertAdapterAuthorized,
  type OfflineHarnessAuthorization,
} from "../../../tools/harness/config.js";
import { spawn } from "node:child_process";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import type { AgentBridgeEvent } from "./types.js";

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
}

function validateEvent(
  value: unknown,
  expected: { runId: string; agentId: string; invocationId: string; ordinal: number },
): AgentBridgeEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Fixture adapter emitted a non-object NDJSON event.");
  }
  const event = value as Record<string, unknown>;
  if (
    event.schemaVersion !== 1 ||
    event.runId !== expected.runId ||
    event.agentId !== expected.agentId ||
    event.invocationId !== expected.invocationId ||
    event.ordinal !== expected.ordinal ||
    typeof event.type !== "string" ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload) ||
    "reasoning" in event ||
    "chainOfThought" in event
  ) {
    throw new Error(`Fixture adapter emitted an invalid event at ordinal ${expected.ordinal}.`);
  }
  canonicalJsonBytes(value);
  return value as AgentBridgeEvent;
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
}): Promise<BridgeProcessResult> {
  authorizeAdapter(options);
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      try {
        if (signal) {
          throw new Error(`Fixture adapter terminated by ${signal}.`);
        }
        const source = Buffer.concat(stdout).toString("utf8");
        const lines = source.split("\n").filter(Boolean);
        const events = lines.map((line, index) =>
          validateEvent(JSON.parse(line), {
            runId: options.runId,
            agentId: options.agentId,
            invocationId: options.invocationId,
            ordinal: index + 1,
          }),
        );
        if (events.at(-1)?.type !== "worker.completed") {
          throw new Error("Fixture adapter did not emit a terminal worker.completed event.");
        }
        if (code !== 0) {
          throw new Error(
            `Fixture adapter exited ${String(code)}: ${Buffer.concat(stderr).toString("utf8")}`,
          );
        }
        resolve({
          events,
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode: code ?? 0,
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
