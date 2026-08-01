import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { requiredFlag } from "../flags.js";
import { appendLifecycleEvent, lifecyclePathFor } from "./lifecycle.js";

const WORKER_ENVIRONMENT = "PALIMPSEST_EXPERIMENT_WORKER";

export function isExperimentWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WORKER_ENVIRONMENT] === "1";
}

export async function superviseExperiment(options: {
  root: string;
  flags: ReadonlyMap<string, string>;
  argv: readonly string[];
  workerScript: string;
  execArgv: readonly string[];
}): Promise<number> {
  const output = resolve(options.root, requiredFlag(options.flags, "--output"));
  const journal = lifecyclePathFor(output);
  const child = spawn(
    process.execPath,
    [...options.execArgv, options.workerScript, ...options.argv],
    {
      stdio: "inherit",
      env: { ...process.env, [WORKER_ENVIRONMENT]: "1" },
    },
  );
  const outcome = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (finish, fail) => {
      child.once("error", fail);
      child.once("exit", (exitCode, signal) => finish({ exitCode, signal }));
    },
  );
  await appendLifecycleEvent(journal, {
    schemaVersion: 1,
    kind: "started",
    at: new Date().toISOString(),
    pid: child.pid ?? -1,
    runId: options.flags.get("--run") ?? null,
  });

  let requestedSignal: NodeJS.Signals | null = null;
  const forward = (signal: NodeJS.Signals) => {
    requestedSignal ??= signal;
    child.kill(signal);
  };
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    const result = await outcome;
    await appendLifecycleEvent(journal, {
      schemaVersion: 1,
      kind: "exited",
      at: new Date().toISOString(),
      ...result,
      requestedSignal,
    });
    return result.exitCode ?? 1;
  } catch (error) {
    await appendLifecycleEvent(journal, {
      schemaVersion: 1,
      kind: "spawn-failed",
      at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", terminate);
  }
}
