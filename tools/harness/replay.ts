import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { canonicalJsonBytes, validateValue } from "@palimpsest/contracts";
import { EventChain } from "@palimpsest/run-control";

import { attemptPath, HARNESS_ROOT, type HarnessAttemptIdentity } from "./config.js";
import { identityFromArgs } from "./grade.js";

const execFileAsync = promisify(execFile);

export async function replayAttempt(
  identity: HarnessAttemptIdentity,
  root = ".",
): Promise<Record<string, unknown>> {
  const attempt = attemptPath(resolve(root, HARNESS_ROOT), identity);
  const events = await EventChain.resume(identity.runId, resolve(attempt, "live.jsonl"));
  const replayed = events.events.find((event) => event.effectId === "lifecycle-replayed");
  await events.append({
    producer: "replay",
    effectId: "lifecycle-replayed",
    eventType: "lifecycle.transition",
    monotonicElapsedNs: replayed?.monotonicElapsedNs ?? String(events.events.length * 1_000_000),
    payload: { state: "REPLAYED" },
  });
  const scored = events.events.find((event) => event.effectId === "lifecycle-scored");
  await events.append({
    producer: "grading",
    effectId: "lifecycle-scored",
    eventType: "lifecycle.transition",
    monotonicElapsedNs: scored?.monotonicElapsedNs ?? String(events.events.length * 1_000_000),
    payload: { state: "SCORED" },
  });
  await execFileAsync(
    "uv",
    [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.replay.harness",
      "--run-id",
      identity.runId,
      "--attempt",
      attempt,
    ],
    { cwd: resolve(root), maxBuffer: 32 * 1024 * 1024 },
  );
  const replay = JSON.parse(await readFile(resolve(attempt, "replay/trusted-replay.json"), "utf8"));
  const publicReport = JSON.parse(await readFile(resolve(attempt, "public/report.json"), "utf8"));
  for (const [contractId, value] of [
    ["trusted-replay-bundle", replay],
    ["public-report-bundle", publicReport],
  ] as const) {
    const verdict = validateValue(contractId, value);
    if (!verdict.accepted) {
      throw new Error(`${contractId} is invalid: ${verdict.reason} at ${verdict.pointer}`);
    }
  }
  return replay as Record<string, unknown>;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `${canonicalJsonBytes(await replayAttempt(identityFromArgs())).toString("utf8")}\n`,
  );
}
