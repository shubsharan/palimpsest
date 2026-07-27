import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sha256Hex } from "@palimpsest/contracts";

import { materializeCheckpointHistory } from "./git-strategies.js";
import { runNetworkIsolated } from "./relay-runner.js";

export const usefulStateStrategies = [
  "canonical-json",
  "deflate-9",
  "field-table-deflate-9",
] as const;

export interface UsefulStateStrategyResult {
  cumulativeCheckpointBytes: number[];
  cumulativeFrameBytes: number;
  encodedByteLengths: number[];
  frameDigests: string[];
  strategyId: string;
}

export async function measureUsefulState(): Promise<UsefulStateStrategyResult[]> {
  const results: UsefulStateStrategyResult[] = [];
  for (const strategyId of usefulStateStrategies) {
    const attemptRoot = await mkdtemp(join(tmpdir(), "palimpsest-useful-state-"));
    try {
      const payloads = [];
      const encodedByteLengths = [];
      for (let version = 1; version <= 4; version += 1) {
        const encodedPath = join(attemptRoot, `${version}.bin`);
        const resultPath = join(attemptRoot, `${version}.json`);
        await runNetworkIsolated("uv", [
          "run",
          "--offline",
          "--frozen",
          "--project",
          "python",
          "python",
          "-m",
          "palimpsest.channel.useful_state_runner",
          "--checkpoint",
          resolve(`artifacts/gate-a/inputs/useful/belief-v${version}.json`),
          "--strategy",
          strategyId,
          "--encoded",
          encodedPath,
          "--result",
          resultPath,
        ]);
        const result = JSON.parse(await readFile(resultPath, "utf8"));
        const payload = await readFile(encodedPath);
        if (
          result.strategyId !== strategyId ||
          result.decodedSemanticEquality !== true ||
          result.encodedByteLength !== payload.length
        ) {
          throw new Error(`Useful-state codec result is inconsistent for ${strategyId}.`);
        }
        payloads.push(payload);
        encodedByteLengths.push(payload.length);
      }
      const materialization = await materializeCheckpointHistory(payloads);
      results.push({
        cumulativeCheckpointBytes: materialization.cumulativeCheckpointBytes,
        cumulativeFrameBytes: materialization.cumulativeFrameBytes,
        encodedByteLengths,
        frameDigests: materialization.frameDigestsInput.map((frame) => sha256Hex(frame)),
        strategyId,
      });
    } finally {
      await rm(attemptRoot, { force: true, recursive: true });
    }
  }
  return results;
}
