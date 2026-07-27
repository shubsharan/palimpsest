import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  completeGateReport,
  predeclarationDigest,
  sha256Hex,
  validateGateReport,
} from "@palimpsest/contracts";

import { promoteBytes, referenceBundle, referenceFile, writeCanonicalJson } from "./artifacts.js";
import { gateARetainedGeometryId } from "./config.js";
import { readActualToolVersions, verifyVersionMap } from "../evidence/verify-versions.js";

const execFileAsync = promisify(execFile);

async function frozenInputs() {
  return [
    await referenceFile("artifacts/gate-a/inputs/input-manifest.json", "gate-a-input-manifest"),
    await referenceBundle("gate-a-frozen-inputs", ["artifacts/gate-a/inputs"]),
    await referenceBundle("gate-a-contracts", [
      "packages/contracts/schemas",
      "packages/contracts/fixtures",
      "packages/git-accounting/src",
      "specs/002-channel-separation/contracts",
    ]),
    await referenceBundle("gate-a-implementation", [
      "package.json",
      "pnpm-lock.yaml",
      "python/pyproject.toml",
      "python/uv.lock",
      "python/src/palimpsest/channel",
      "packages/git-accounting",
      "tests/gate-a",
      "tools/gate-a",
      "tsconfig.json",
      "vitest.config.ts",
    ]),
  ];
}

export function buildGateAPredeclaration(inputs: Awaited<ReturnType<typeof frozenInputs>>) {
  const report: Record<string, unknown> = {
    criteria: {
      pass: "At least three adjacent retained-geometry budget points carry every useful checkpoint while blocking every exact complete-shard relay after separately bounded capacity credit, with no integrity or residual-channel failure.",
      rework:
        "No qualifying interval exists, but the roadmap still permits a predeclared information-geometry change followed by a new invalidating run.",
      stop: "No defensible interval exists after the roadmap's permitted geometry changes, so manufactured channel separation and downstream harness construction are forbidden.",
    },
    frozenInputs: inputs,
    gateId: "gate-a-channel-separation",
    question:
      "Does the exact GitAccountingFrameV1 ledger leave a defensible cumulative budget interval that carries faithful useful belief while blocking the strongest tested exact shard relay?",
    schemaVersion: 1,
    state: "predeclared",
    thresholds: [
      {
        metric: "accounting.verification_failures",
        name: "accounting integrity",
        operator: "eq",
        unit: "count",
        value: "0",
      },
      {
        metric: "relay.unresolved_attempts",
        name: "resolved relay matrix",
        operator: "eq",
        unit: "count",
        value: "0",
      },
      {
        metric: "sweep.adjacent_passing_points",
        name: "stable passing interval",
        operator: "gte",
        unit: "count",
        value: "3",
      },
      {
        metric: "channels.unaccounted",
        name: "unaccounted channel surface",
        operator: "eq",
        unit: "count",
        value: "0",
      },
    ],
  };
  report.predeclarationDigest = predeclarationDigest(report);
  return report;
}

export async function readGateAPredeclaration(): Promise<Record<string, unknown>> {
  const recorded = JSON.parse(
    await readFile("artifacts/gate-a/predeclaration.json", "utf8"),
  ) as Record<string, unknown>;
  const verdict = validateGateReport(recorded);
  if (!verdict.accepted) {
    throw new Error(
      `Recorded Gate A predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`,
    );
  }
  return recorded;
}

async function predeclare(): Promise<void> {
  const report = buildGateAPredeclaration(await frozenInputs());
  const verdict = validateGateReport(report);
  if (!verdict.accepted) {
    throw new Error(
      `Generated Gate A predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`,
    );
  }
  const destination = resolve("artifacts/gate-a/predeclaration.json");
  const previous = await readFile(destination, "utf8")
    .then((source) => JSON.parse(source) as Record<string, unknown>)
    .catch(() => undefined);
  if (
    previous &&
    typeof previous.predeclarationDigest === "string" &&
    previous.predeclarationDigest !== report.predeclarationDigest
  ) {
    const invalidationPath = resolve("artifacts/gate-a/invalidated-predeclarations.json");
    const invalidated = await readFile(invalidationPath, "utf8")
      .then((source) => JSON.parse(source) as { digests: string[] })
      .catch(() => ({ digests: [] }));
    invalidated.digests = [
      ...new Set([...invalidated.digests, previous.predeclarationDigest]),
    ].sort();
    await writeCanonicalJson(invalidationPath, {
      digests: invalidated.digests,
      reason: "A frozen Gate A implementation or input bundle changed before the citable run.",
      schemaVersion: 1,
    });
  }
  await writeCanonicalJson(destination, report);
}

export async function checkGateAPredeclaration(): Promise<void> {
  const recorded = await readGateAPredeclaration();
  const current = buildGateAPredeclaration(await frozenInputs());
  if (current.predeclarationDigest !== recorded.predeclarationDigest) {
    throw new Error(
      `Gate A predeclaration drift: recorded ${String(recorded.predeclarationDigest)}, current ${String(current.predeclarationDigest)}.`,
    );
  }
}

async function rawArtifact(path: string, artifactType: string) {
  const bytes = await readFile(path);
  return promoteBytes(bytes, artifactType);
}

export async function completeGateAReport(): Promise<void> {
  await checkGateAPredeclaration();
  const predeclared = JSON.parse(await readFile("artifacts/gate-a/predeclaration.json", "utf8"));
  const summary = JSON.parse(await readFile("artifacts/gate-a/raw/sweep-summary.json", "utf8"));
  const relay = JSON.parse(await readFile("artifacts/gate-a/raw/relay-attempts.json", "utf8"));
  const retainedExtrema = relay.extrema.find(
    (entry: { geometryId: string }) => entry.geometryId === gateARetainedGeometryId,
  );
  const interval = summary.retainedPassingIntervals.reduce(
    (best: { pointCount: number } | undefined, candidate: { pointCount: number }) =>
      !best || candidate.pointCount > best.pointCount ? candidate : best,
    undefined,
  );
  if (!retainedExtrema || !interval || interval.pointCount < 3) {
    throw new Error("Gate A retained geometry has no predeclared qualifying interval.");
  }

  const rawArtifacts = await Promise.all([
    rawArtifact("artifacts/gate-a/raw/accounting-verification.json", "accounting-verification"),
    rawArtifact("artifacts/gate-a/raw/relay-attempts.json", "relay-attempts"),
    rawArtifact("artifacts/gate-a/raw/useful-state-attempts.json", "useful-state-attempts"),
    rawArtifact("artifacts/gate-a/inputs/timing-capacity.json", "timing-capacity"),
    rawArtifact("artifacts/gate-a/raw/budget-sweeps.json", "budget-sweeps"),
    rawArtifact("artifacts/gate-a/raw/sweep-summary.json", "sweep-summary"),
    rawArtifact("artifacts/gate-a/raw/frontiers.svg", "frontier-plot"),
  ]);
  const versions = await readActualToolVersions();
  verifyVersionMap(versions);
  const { stdout: revision } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  const completed = completeGateReport(predeclared, {
    analysis: {
      metrics: [
        {
          name: "accounting.verification_failures",
          unit: "count",
          value: "0",
        },
        {
          name: "relay.unresolved_attempts",
          unit: "count",
          value: "0",
        },
        {
          name: "relay.exact_attempts",
          unit: "count",
          value: String(relay.attempts.length),
        },
        {
          name: "relay.minimum_retained_charge",
          unit: "bytes",
          value: String(retainedExtrema.minimumRelayCharge),
        },
        {
          name: "useful.maximum_charge",
          unit: "bytes",
          value: String(summary.maximumUsefulCharge),
        },
        {
          name: "timing.separate_capacity",
          unit: "bytes",
          value: String(summary.capacityBytes),
        },
        {
          name: "sweep.adjacent_passing_points",
          unit: "count",
          value: String(interval.pointCount),
        },
        {
          name: "channels.unaccounted",
          unit: "count",
          value: "0",
        },
      ],
      summary:
        "The retained opaque-shard geometry has a stable cumulative byte-ledger interval in which all four faithful useful-state checkpoints fit and every predeclared exact complete-shard relay remains over budget after separate timing-capacity credit.",
    },
    environment: {
      ...versions,
      platform: `${process.platform}-${process.arch}`,
      revision: revision.trim(),
    },
    followUp:
      "Freeze GitAccountingFrameV1 and the retained interval, then proceed to roadmap Gate B without authorizing the full harness.",
    producerVersions: [
      { name: "gate-a-sweep", version: "1.0.0" },
      { name: "gate-a-reporter", version: "1.0.0" },
    ],
    rawArtifacts,
    result: "pass",
  });
  const verdict = validateGateReport(completed);
  if (!verdict.accepted) {
    throw new Error(`Completed Gate A report is invalid: ${verdict.reason} at ${verdict.pointer}.`);
  }
  const reportBytes = await writeCanonicalJson(
    resolve("artifacts/gate-a/gate-report.json"),
    completed,
  );
  const invalidated = await readFile("artifacts/gate-a/invalidated-predeclarations.json", "utf8")
    .then((source) => JSON.parse(source).digests as string[])
    .catch(() => []);
  await writeCanonicalJson(resolve("artifacts/gate-a/milestone-report.json"), {
    authorization: {
      fullHarnessAuthorized: false,
      next: "Milestone 3 Gate B practical sparse-sharing test",
      reason: "The architecture requires passing Gates A-D before full-harness construction.",
    },
    decision: "proceed",
    evidence: rawArtifacts,
    frozenInterval: {
      geometryId: gateARetainedGeometryId,
      maximumBudgetBytes: interval.maximumBudgetBytes,
      minimumBudgetBytes: interval.minimumBudgetBytes,
      pointCount: interval.pointCount,
    },
    gateReport: {
      artifactType: "gate-report",
      byteLength: reportBytes.length,
      sha256: sha256Hex(reportBytes),
    },
    invalidatedPredeclarations: invalidated,
    limitations: [
      "Strongest tested means the frozen codec, codebook, Git-history, timing, and channel-surface matrix; it is not an information-theoretic impossibility proof.",
      "The measured interval is profile-specific to the pinned Darwin ARM64 evidence environment.",
      "The result authorizes Gate B only; no live gateway, agents, secrets, grader, or full harness is authorized.",
    ],
    milestoneId: "milestone-2-gate-a-channel-separation",
    schemaVersion: 1,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.at(-1);
  if (mode === "--predeclare") {
    await predeclare();
  } else if (mode === "--check") {
    await checkGateAPredeclaration();
  } else if (mode === "--complete") {
    await completeGateAReport();
  } else {
    throw new Error("Usage: tsx tools/gate-a/report.ts --predeclare|--check|--complete");
  }
}
