import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ExperimentLifecycleEvent =
  | Readonly<{
      schemaVersion: 1;
      kind: "started";
      at: string;
      pid: number;
      runId: string | null;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: "exited";
      at: string;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      requestedSignal: NodeJS.Signals | null;
    }>
  | Readonly<{
      schemaVersion: 1;
      kind: "spawn-failed";
      at: string;
      error: string;
    }>;

export function lifecyclePathFor(output: string): string {
  return `${resolve(output)}.lifecycle.jsonl`;
}

export async function appendLifecycleEvent(
  path: string,
  event: ExperimentLifecycleEvent,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}
