import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { sha256Hex, validateValue } from "@palimpsest/contracts";

import {
  promoteBytes,
  referenceFile,
  writeCanonicalJson,
  type ArtifactReference,
} from "./artifacts.js";
import { gateAGeometries, gateARetainedGeometryId, gateAStrategies } from "./config.js";
import { materializeAcrossGitStrategies } from "./git-strategies.js";
import { runNetworkIsolated, runRelayCodec } from "./relay-runner.js";
import { checkGateAPredeclaration } from "./report.js";
import { timingCapacityResult } from "./timing-capacity.js";
import { measureUsefulState } from "./useful-state.js";

interface GeometryExtrema {
  geometryId: string;
  minimumRelayCharge: number;
  winningAttemptId: string;
}

function frontierSvg(extrema: GeometryExtrema[], maximumUsefulCharge: number): string {
  const width = 960;
  const height = 480;
  const margin = 72;
  const plotWidth = width - margin * 2;
  const plotHeight = height - margin * 2;
  const maximumCharge = Math.max(
    maximumUsefulCharge,
    ...extrema.map(({ minimumRelayCharge }) => minimumRelayCharge),
  );
  const points = extrema
    .map(({ minimumRelayCharge }, index) => {
      const x = margin + (plotWidth * index) / (extrema.length - 1);
      const y = height - margin - (plotHeight * minimumRelayCharge) / maximumCharge;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const usefulY = height - margin - (plotHeight * maximumUsefulCharge) / maximumCharge;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">`,
    '<title id="title">Gate A cumulative frame frontiers</title>',
    '<desc id="desc">Minimum exact relay charge by frozen geometry and maximum useful-state charge.</desc>',
    '<rect width="100%" height="100%" fill="#f5f0e6"/>',
    `<path d="M${margin} ${margin}V${height - margin}H${width - margin}" fill="none" stroke="#23231f" stroke-width="2"/>`,
    `<line x1="${margin}" y1="${usefulY.toFixed(2)}" x2="${width - margin}" y2="${usefulY.toFixed(2)}" stroke="#b4412f" stroke-width="3" stroke-dasharray="10 8"/>`,
    `<polyline points="${points}" fill="none" stroke="#1f6673" stroke-width="4"/>`,
    ...points.split(" ").map((point) => {
      const [x, y] = point.split(",");
      return `<circle cx="${x}" cy="${y}" r="5" fill="#1f6673"/>`;
    }),
    `<text x="${margin}" y="${(usefulY - 10).toFixed(2)}" font-family="Georgia,serif" font-size="16" fill="#8f3023">Useful maximum: ${maximumUsefulCharge} bytes</text>`,
    `<text x="${width / 2}" y="${height - 20}" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="#23231f">Frozen geometry matrix</text>`,
    `<text x="20" y="${height / 2}" transform="rotate(-90 20 ${height / 2})" text-anchor="middle" font-family="Georgia,serif" font-size="16" fill="#23231f">Cumulative frame bytes</text>`,
    "</svg>",
    "",
  ].join("\n");
}

async function promoteFrames(frames: Buffer[]): Promise<ArtifactReference[]> {
  const references = [];
  for (const frame of frames) {
    references.push(await promoteBytes(frame, "git-accounting-frame"));
  }
  return references;
}

async function inputReferences(
  geometryId: string,
  accessedInputs: string[],
): Promise<ArtifactReference[]> {
  const references = [
    await referenceFile(
      `artifacts/gate-a/inputs/fixtures/${geometryId}.opaque.txt`,
      "opaque-shard",
    ),
  ];
  if (accessedInputs.includes("source-corpus") || accessedInputs.includes("reference-text")) {
    references.push(
      await referenceFile(
        "artifacts/gate-a/inputs/sources/provenance.json",
        "gate-a-source-provenance",
      ),
    );
    for (const sourceId of ["middlemarch", "moby-dick", "count-of-monte-cristo", "jane-eyre"]) {
      references.push(
        await referenceFile(
          `artifacts/gate-a/inputs/sources/${sourceId}.txt`,
          "public-domain-source",
        ),
      );
    }
  }
  if (accessedInputs.includes("shared-vocabulary-order")) {
    references.push(
      await referenceFile(
        `artifacts/gate-a/inputs/fixtures/${geometryId}.vocabulary.json`,
        "shared-vocabulary",
      ),
    );
  }
  return references;
}

async function buildSweepResult(
  geometryId: string,
  maximumUsefulCharge: number,
  minimumRelayCharge: number,
  capacityBytes: number,
) {
  const root = await mkdtemp(join(tmpdir(), "palimpsest-gate-a-analysis-"));
  try {
    const output = join(root, "sweep.json");
    await runNetworkIsolated("uv", [
      "run",
      "--offline",
      "--frozen",
      "--project",
      "python",
      "python",
      "-m",
      "palimpsest.channel.analysis",
      "--geometry-id",
      geometryId,
      "--maximum-useful-charge",
      String(maximumUsefulCharge),
      "--minimum-relay-charge",
      String(minimumRelayCharge),
      "--relay-capacity-credit-bytes",
      String(capacityBytes),
      "--output",
      output,
    ]);
    const result = JSON.parse(await readFile(output, "utf8"));
    const verdict = validateValue("budget-sweep-result", result);
    if (!verdict.accepted) {
      throw new Error(
        `Budget sweep ${geometryId} is invalid: ${verdict.reason} at ${verdict.pointer}.`,
      );
    }
    return result;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

await checkGateAPredeclaration();

const relayAttempts = [];
const encodedArtifacts = [];
const extrema: GeometryExtrema[] = [];
for (const geometry of gateAGeometries) {
  let minimumRelayCharge = Number.POSITIVE_INFINITY;
  let winningAttemptId = "";
  for (const strategy of gateAStrategies) {
    const codec = await runRelayCodec({
      fixtureMetadataPath: resolve(`artifacts/gate-a/inputs/fixtures/${geometry.geometryId}.json`),
      opaquePath: resolve(`artifacts/gate-a/inputs/fixtures/${geometry.geometryId}.opaque.txt`),
      sourceRoot: resolve("artifacts/gate-a/inputs/sources"),
      strategyId: strategy.strategyId,
    });
    const encodedReference = await promoteBytes(codec.encoded, "relay-encoded-payload");
    encodedArtifacts.push({
      geometryId: geometry.geometryId,
      networkIsolation: codec.networkIsolation,
      strategyId: strategy.strategyId,
      ...encodedReference,
    });
    const materializations = await materializeAcrossGitStrategies(codec.encoded);
    for (const materialization of materializations) {
      if (!materialization.exactReconstruction) {
        throw new Error(
          `${geometry.geometryId}/${strategy.strategyId}/${materialization.strategyId} failed encoded-payload reconstruction.`,
        );
      }
      const attemptId = `${geometry.geometryId}-${strategy.strategyId}-${materialization.strategyId}`;
      const frameReferences = await promoteFrames(materialization.frameDigestsInput);
      const attempt = {
        accessedInputs: await inputReferences(geometry.geometryId, codec.accessedInputs),
        attemptId,
        contractId: "relay-attempt-result",
        decodedOutput: await referenceFile(
          `artifacts/gate-a/inputs/fixtures/${geometry.geometryId}.opaque.txt`,
          "opaque-shard",
        ),
        exactReconstruction: true,
        failureCode: null,
        fixtureId: geometry.geometryId,
        frameBytes: String(materialization.cumulativeFrameBytes),
        frameDigests: frameReferences.map(({ sha256 }) => sha256),
        schemaVersion: 1,
        separateCapacityBits: timingCapacityResult().totalBits,
        status: "promoted",
        strategyId: strategy.strategyId,
        transactions: frameReferences,
      };
      const verdict = validateValue("relay-attempt-result", attempt);
      if (!verdict.accepted) {
        throw new Error(
          `Relay attempt ${attemptId} is invalid: ${verdict.reason} at ${verdict.pointer}.`,
        );
      }
      relayAttempts.push(attempt);
      if (materialization.cumulativeFrameBytes < minimumRelayCharge) {
        minimumRelayCharge = materialization.cumulativeFrameBytes;
        winningAttemptId = attemptId;
      }
    }
  }
  extrema.push({
    geometryId: geometry.geometryId,
    minimumRelayCharge,
    winningAttemptId,
  });
  process.stdout.write(
    `Measured ${geometry.geometryId}: minimum relay charge ${minimumRelayCharge} bytes.\n`,
  );
}

const usefulResults = await measureUsefulState();
const bestUseful = usefulResults.reduce((best, candidate) =>
  candidate.cumulativeFrameBytes < best.cumulativeFrameBytes ? candidate : best,
);
const capacityBytes = Number(timingCapacityResult().capacityBytes);
const sweepResults = [];
for (const geometry of extrema) {
  sweepResults.push(
    await buildSweepResult(
      geometry.geometryId,
      bestUseful.cumulativeFrameBytes,
      geometry.minimumRelayCharge,
      capacityBytes,
    ),
  );
}

const relayBytes = await writeCanonicalJson(resolve("artifacts/gate-a/raw/relay-attempts.json"), {
  attempts: relayAttempts,
  encodedArtifacts,
  extrema,
  schemaVersion: 1,
});
const usefulBytes = await writeCanonicalJson(
  resolve("artifacts/gate-a/raw/useful-state-attempts.json"),
  {
    bestStrategyId: bestUseful.strategyId,
    maximumUsefulCharge: bestUseful.cumulativeFrameBytes,
    schemaVersion: 1,
    strategies: usefulResults,
  },
);
const sweepBytes = await writeCanonicalJson(resolve("artifacts/gate-a/raw/budget-sweeps.json"), {
  retainedGeometryId: gateARetainedGeometryId,
  schemaVersion: 1,
  sweeps: sweepResults,
});
const plotBytes = Buffer.from(frontierSvg(extrema, bestUseful.cumulativeFrameBytes), "utf8");
await writeFile(resolve("artifacts/gate-a/raw/frontiers.svg"), plotBytes);
const retainedSweep = sweepResults.find((result) => result.geometryId === gateARetainedGeometryId);
if (!retainedSweep) {
  throw new Error(`Retained geometry is missing: ${gateARetainedGeometryId}.`);
}
await writeCanonicalJson(resolve("artifacts/gate-a/raw/sweep-summary.json"), {
  capacityBytes,
  maximumUsefulCharge: bestUseful.cumulativeFrameBytes,
  rawArtifacts: [
    {
      artifactType: "relay-attempts",
      byteLength: relayBytes.length,
      sha256: sha256Hex(relayBytes),
    },
    {
      artifactType: "useful-state-attempts",
      byteLength: usefulBytes.length,
      sha256: sha256Hex(usefulBytes),
    },
    {
      artifactType: "budget-sweeps",
      byteLength: sweepBytes.length,
      sha256: sha256Hex(sweepBytes),
    },
    {
      artifactType: "frontier-plot",
      byteLength: plotBytes.length,
      sha256: sha256Hex(plotBytes),
    },
  ],
  retainedGeometryId: gateARetainedGeometryId,
  retainedPassingIntervals: retainedSweep.passingIntervals,
  schemaVersion: 1,
});
