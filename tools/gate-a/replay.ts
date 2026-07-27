import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJsonBytes,
  sha256Hex,
  validateGateReport,
  validateValue,
} from "@palimpsest/contracts";
import { decodeGitAccountingFrame, encodeGitAccountingFrame } from "@palimpsest/git-accounting";

import { gateARetainedGeometryId } from "./config.js";
import { readGateAPredeclaration } from "./report.js";

interface ArtifactReference {
  artifactType: string;
  byteLength: number;
  sha256: string;
}

async function resolveDigest(reference: ArtifactReference): Promise<Buffer> {
  const bytes = await readFile(`artifacts/gate-a/by-digest/${reference.sha256}`);
  if (bytes.length !== reference.byteLength || sha256Hex(bytes) !== reference.sha256) {
    throw new Error(`Digest store mismatch for ${reference.artifactType}/${reference.sha256}.`);
  }
  return bytes;
}

function recomputeSweep(
  geometryId: string,
  maximumUsefulCharge: number,
  minimumRelayCharge: number,
  capacityBytes: number,
) {
  const points = [];
  for (let budgetBytes = 4_096; budgetBytes <= 65_536; budgetBytes += 1_024) {
    const usefulFits = maximumUsefulCharge <= budgetBytes;
    const relayBlocked = minimumRelayCharge - capacityBytes > budgetBytes;
    points.push({
      budgetBytes,
      classification: usefulFits && relayBlocked ? "pass" : "fail",
      maximumUsefulCharge: String(maximumUsefulCharge),
      minimumRelayCharge: String(minimumRelayCharge),
      relayBlocked,
      relayCapacityCreditBytes: String(capacityBytes),
      usefulFits,
    });
  }
  const passingIntervals = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (const point of points) {
    if (point.classification === "pass") {
      start ??= point.budgetBytes;
      previous = point.budgetBytes;
    } else if (start !== undefined && previous !== undefined) {
      passingIntervals.push({
        maximumBudgetBytes: previous,
        minimumBudgetBytes: start,
        pointCount: (previous - start) / 1_024 + 1,
      });
      start = undefined;
      previous = undefined;
    }
  }
  if (start !== undefined && previous !== undefined) {
    passingIntervals.push({
      maximumBudgetBytes: previous,
      minimumBudgetBytes: start,
      pointCount: (previous - start) / 1_024 + 1,
    });
  }
  return {
    contractId: "budget-sweep-result",
    geometryId,
    minimumAdjacentPassingPoints: 3,
    passingIntervals,
    points,
    schemaVersion: 1,
  };
}

export async function replayGateA() {
  const recordedPredeclaration = await readGateAPredeclaration();
  const report = JSON.parse(await readFile("artifacts/gate-a/gate-report.json", "utf8"));
  const verdict = validateGateReport(report);
  if (!verdict.accepted || report.state !== "completed") {
    throw new Error(`Gate A report is invalid: ${verdict.reason} at ${verdict.pointer}.`);
  }
  if (report.predeclarationDigest !== recordedPredeclaration.predeclarationDigest) {
    throw new Error("Gate A report does not complete the recorded predeclaration.");
  }
  const resolved = new Map<string, Buffer>();
  for (const reference of report.rawArtifacts as ArtifactReference[]) {
    resolved.set(reference.artifactType, await resolveDigest(reference));
  }
  const relay = JSON.parse(resolved.get("relay-attempts")!.toString("utf8"));
  const useful = JSON.parse(resolved.get("useful-state-attempts")!.toString("utf8"));
  const recordedSweeps = JSON.parse(resolved.get("budget-sweeps")!.toString("utf8"));
  const timing = JSON.parse(resolved.get("timing-capacity")!.toString("utf8"));
  if (
    relay.attempts.length !== 630 ||
    relay.attempts.some(
      (attempt: { exactReconstruction: boolean; status: string }) =>
        !attempt.exactReconstruction || attempt.status !== "promoted",
    )
  ) {
    throw new Error("Relay matrix is incomplete or contains an unresolved attempt.");
  }
  for (const attempt of relay.attempts) {
    const attemptVerdict = validateValue("relay-attempt-result", attempt);
    if (!attemptVerdict.accepted) {
      throw new Error(
        `Relay attempt ${attempt.attemptId} is invalid: ${attemptVerdict.reason} at ${attemptVerdict.pointer}.`,
      );
    }
    let frameBytes = 0;
    for (const transaction of attempt.transactions as ArtifactReference[]) {
      const bytes = await resolveDigest(transaction);
      const frame = decodeGitAccountingFrame(bytes);
      if (!encodeGitAccountingFrame(frame).equals(bytes)) {
        throw new Error(`Frame ${transaction.sha256} is not canonical.`);
      }
      frameBytes += bytes.length;
    }
    if (String(frameBytes) !== attempt.frameBytes) {
      throw new Error(`Relay attempt ${attempt.attemptId} has a false cumulative charge.`);
    }
  }
  const bestUseful = useful.strategies.reduce(
    (best: { cumulativeFrameBytes: number }, candidate: { cumulativeFrameBytes: number }) =>
      candidate.cumulativeFrameBytes < best.cumulativeFrameBytes ? candidate : best,
  );
  if (
    bestUseful.cumulativeFrameBytes !== useful.maximumUsefulCharge ||
    bestUseful.cumulativeCheckpointBytes.length !== 4
  ) {
    throw new Error("Useful-state extrema or checkpoint history is inconsistent.");
  }
  const capacityBytes = Number(timing.capacityBytes);
  const recomputedSweeps = relay.extrema.map(
    (extrema: { geometryId: string; minimumRelayCharge: number }) =>
      recomputeSweep(
        extrema.geometryId,
        bestUseful.cumulativeFrameBytes,
        extrema.minimumRelayCharge,
        capacityBytes,
      ),
  );
  if (!canonicalJsonBytes(recomputedSweeps).equals(canonicalJsonBytes(recordedSweeps.sweeps))) {
    throw new Error("Independently recomputed budget sweeps differ from recorded evidence.");
  }
  const retained = recomputedSweeps.find(
    (sweep: { geometryId: string }) => sweep.geometryId === gateARetainedGeometryId,
  );
  const maximumAdjacentPoints = Math.max(
    ...retained.passingIntervals.map((interval: { pointCount: number }) => interval.pointCount),
  );
  if (maximumAdjacentPoints < 3 || report.result !== "pass") {
    throw new Error("Gate A decision does not follow the predeclared pass rule.");
  }
  return {
    attemptCount: relay.attempts.length,
    maximumAdjacentPoints,
    retainedGeometryId: gateARetainedGeometryId,
    result: report.result,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await replayGateA();
  process.stdout.write(
    `Gate A replay passed: ${result.attemptCount} attempts, ${result.maximumAdjacentPoints} adjacent retained points.\n`,
  );
}
