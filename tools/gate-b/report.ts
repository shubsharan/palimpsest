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
  validateValue,
} from "@palimpsest/contracts";

import {
  promoteGateBBundle,
  promoteGateBBytes,
  referenceBundle,
  referenceFile,
  writeCanonicalJson,
} from "./artifacts.js";
import { gateBDecisionThresholds, gateBInstances, gateBProfileId } from "./config.js";
import { readActualToolVersions, verifyVersionMap } from "../evidence/verify-versions.js";

const execFileAsync = promisify(execFile);

async function frozenInputs() {
  return [
    await referenceFile("artifacts/gate-b/inputs/input-manifest.json", "gate-b-input-manifest"),
    await referenceBundle("gate-b-contracts", [
      "packages/contracts/schemas/gate-b",
      "packages/contracts/fixtures/gate-b",
      "specs/003-decipherment-headroom/contracts",
    ]),
    await referenceBundle("gate-b-implementation", [
      "package.json",
      "pnpm-lock.yaml",
      "python/pyproject.toml",
      "python/uv.lock",
      "python/src/palimpsest/baselines",
      "python/src/palimpsest/corpus",
      "python/src/palimpsest/gate_b",
      "python/src/palimpsest/generation",
      "python/src/palimpsest/grading",
      "python/src/palimpsest/identification",
      "python/tests/gate_b",
      "tests/gate-b",
      "tools/gate-a/artifacts.ts",
      "tools/gate-b",
      "tsconfig.json",
      "vitest.config.ts",
    ]),
  ];
}

export function buildGateBPredeclaration(inputs: Awaited<ReturnType<typeof frozenInputs>>) {
  const thresholdEntries = [
    {
      metric: "mechanical.maximum",
      name: "mechanical saturation ceiling",
      operator: "lt",
      unit: "fraction",
      value: String(gateBDecisionThresholds.mechanicalMaximumExclusive),
    },
    {
      metric: "mechanical.unresolved",
      name: "mechanical unresolved floor",
      operator: "gte",
      unit: "fraction",
      value: String(gateBDecisionThresholds.mechanicalUnresolvedMinimumInclusive),
    },
    {
      metric: "capable.gain",
      name: "capable solver gain",
      operator: "gte",
      unit: "fraction",
      value: String(gateBDecisionThresholds.capableGainMinimumInclusive),
    },
    {
      metric: "capable.final",
      name: "capable solver final floor",
      operator: "gte",
      unit: "fraction",
      value: String(gateBDecisionThresholds.capableFinalMinimumInclusive),
    },
    {
      metric: "entity.consistency",
      name: "entity mention consistency",
      operator: "gte",
      unit: "fraction",
      value: String(gateBDecisionThresholds.entityConsistencyMinimumInclusive),
    },
    {
      metric: "entity.missed",
      name: "missed entity ceiling",
      operator: "lte",
      unit: "fraction",
      value: String(gateBDecisionThresholds.entityMissedMaximumInclusive),
    },
    {
      metric: "entity.overcapture",
      name: "common noun overcapture ceiling",
      operator: "lte",
      unit: "fraction",
      value: String(gateBDecisionThresholds.commonNounOverCaptureMaximumInclusive),
    },
    {
      metric: "entity.collisions",
      name: "generated entity collisions",
      operator: "eq",
      unit: "count",
      value: String(gateBDecisionThresholds.generatedNameCollisions),
    },
  ] as const;
  const report: Record<string, unknown> = {
    criteria: {
      pass: "Every retained instance preserves mechanical headroom, both capable-solver conditions show predeclared progress and final competence, recognition remains safe, entity audits pass, and the residual concentrates on rare content and regenerated entities.",
      rework:
        "Integrity is sound and mechanical saturation is absent, but a declared source, entity, or stationary-profile dial requires one invalidating rerun.",
      stop: "Mechanical methods saturate the puzzle or capable solvers cannot make meaningful progress under the frozen condition.",
    },
    frozenInputs: inputs,
    gateId: "gate-b-decipherment-headroom",
    question:
      "Does the frozen stationary sparse-sharing profile leave practical decipherment headroom for capable solvers without collapsing under mechanical or recognition attacks?",
    schemaVersion: 1,
    state: "predeclared",
    thresholds: thresholdEntries,
  };
  report.predeclarationDigest = predeclarationDigest(report);
  return report;
}

async function predeclare(): Promise<void> {
  const report = buildGateBPredeclaration(await frozenInputs());
  const verdict = validateGateReport(report);
  if (!verdict.accepted) {
    throw new Error(
      `Generated Gate B predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}.`,
    );
  }
  const destination = resolve("artifacts/gate-b/predeclaration.json");
  const previous = await readFile(destination, "utf8")
    .then((source) => JSON.parse(source) as Record<string, unknown>)
    .catch(() => undefined);
  if (
    previous &&
    typeof previous.predeclarationDigest === "string" &&
    previous.predeclarationDigest !== report.predeclarationDigest
  ) {
    const invalidationPath = resolve("artifacts/gate-b/invalidated-predeclarations.json");
    const invalidated = await readFile(invalidationPath, "utf8")
      .then((source) => JSON.parse(source) as { digests: string[] })
      .catch(() => ({ digests: [] }));
    invalidated.digests = [
      ...new Set([...invalidated.digests, previous.predeclarationDigest]),
    ].sort();
    await writeCanonicalJson(invalidationPath, {
      digests: invalidated.digests,
      reason: "A frozen Gate B implementation, policy, model, source, or input changed.",
      schemaVersion: 1,
    });
  }
  await writeCanonicalJson(destination, report);
}

export async function checkGateBPredeclaration(): Promise<void> {
  const recorded = JSON.parse(
    await readFile("artifacts/gate-b/predeclaration.json", "utf8"),
  ) as Record<string, unknown>;
  const verdict = validateGateReport(recorded);
  if (!verdict.accepted) {
    throw new Error(
      `Recorded Gate B predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}.`,
    );
  }
  const current = buildGateBPredeclaration(await frozenInputs());
  if (current.predeclarationDigest !== recorded.predeclarationDigest) {
    throw new Error(
      `Gate B predeclaration drift: recorded ${String(recorded.predeclarationDigest)}, current ${String(current.predeclarationDigest)}.`,
    );
  }
}

async function promoteJson(path: string, artifactType: string) {
  return promoteGateBBytes(await readFile(path), artifactType);
}

async function selectedAgentEvidenceRoots(): Promise<string[]> {
  const predeclaration = JSON.parse(
    await readFile("artifacts/gate-b/predeclaration.json", "utf8"),
  ) as { predeclarationDigest: string };
  const roots: string[] = [];
  for (const { instanceId } of gateBInstances) {
    const selectionPath = `artifacts/gate-b/attempts/agent/${instanceId}/selected.json`;
    const selection = JSON.parse(await readFile(selectionPath, "utf8")) as Record<string, unknown>;
    const attemptPath = selection.attemptPath;
    const digest = selection.predeclarationDigest;
    const runId = selection.runId;
    if (
      selection.instanceId !== instanceId ||
      selection.condition !== "frontier-agent-tools" ||
      selection.terminalStatus !== "completed" ||
      digest !== predeclaration.predeclarationDigest ||
      typeof attemptPath !== "string" ||
      typeof runId !== "string"
    ) {
      throw new Error(`${selectionPath} does not select a current completed agent attempt.`);
    }
    const expected = resolve("artifacts/gate-b/attempts/agent", instanceId, digest, runId);
    if (resolve(attemptPath) !== expected) {
      throw new Error(`${selectionPath} points outside its declared attempt directory.`);
    }
    roots.push(selectionPath, attemptPath);
  }
  return roots;
}

export async function completeGateBReport(): Promise<void> {
  await checkGateBPredeclaration();
  const predeclared = JSON.parse(await readFile("artifacts/gate-b/predeclaration.json", "utf8"));
  const analysis = JSON.parse(await readFile("artifacts/gate-b/raw/analysis-summary.json", "utf8"));
  const decision = JSON.parse(
    await readFile("artifacts/gate-b/raw/decision-analysis.json", "utf8"),
  );
  const decisionVerdict = validateValue("gate-b-decision-analysis", decision);
  if (!decisionVerdict.accepted) {
    throw new Error(
      `Gate B decision is invalid: ${decisionVerdict.reason} at ${decisionVerdict.pointer}.`,
    );
  }
  if (!["pass", "rework", "stop"].includes(decision.classification)) {
    throw new Error(
      "Gate B cannot complete until all judged mechanical, identification, agent, human, audit, and score evidence is present.",
    );
  }
  const rawArtifacts = await Promise.all([
    promoteGateBBundle("gate-b-instances", ["artifacts/gate-b/instances"]),
    promoteGateBBundle("gate-b-source-role-admission", ["artifacts/gate-b/admission"]),
    promoteGateBBundle("gate-b-mechanical-attempts", ["artifacts/gate-b/attempts/mechanical"]),
    promoteGateBBundle("gate-b-identification-attempts", [
      "artifacts/gate-b/attempts/identification",
    ]),
    promoteGateBBundle("gate-b-agent-attempts", await selectedAgentEvidenceRoots()),
    promoteGateBBundle("gate-b-human-attempts", ["artifacts/gate-b/attempts/human"]),
    promoteGateBBundle("gate-b-entity-audits", ["artifacts/gate-b/audits"]),
    promoteJson("artifacts/gate-b/raw/all-scores.json", "gate-b-score-table"),
    promoteJson("artifacts/gate-b/raw/decision-analysis.json", "gate-b-decision-analysis"),
    promoteJson("artifacts/gate-b/raw/analysis-summary.json", "gate-b-analysis-summary"),
    promoteJson("artifacts/gate-b/raw/identification-summary.json", "identification-summary"),
    promoteJson("artifacts/gate-b/raw/entity-audit-summary.json", "entity-audit-summary"),
  ]);
  const versions = await readActualToolVersions();
  verifyVersionMap(versions);
  const { stdout: revision } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  const result = decision.classification as "pass" | "rework" | "stop";
  const completed = completeGateReport(predeclared, {
    analysis: {
      metrics: [
        {
          name: "mechanical.maximum",
          unit: "fraction",
          value: String(Math.max(...Object.values(analysis.mechanical as Record<string, number>))),
        },
        {
          name: "entity.consistency",
          unit: "boolean",
          value: String(decision.entityAcceptable),
        },
        {
          name: "residual.designed",
          unit: "boolean",
          value: String(decision.designedResidual),
        },
        {
          name: "integrity.failures",
          unit: "count",
          value: String(decision.integrityFailures.length),
        },
      ],
      summary:
        "The completed decision is reproduced from three stationary instances, the full five-rung mechanical and four-track recognition matrices, entity audits, and three ordered checkpoints for each capable-solver condition.",
    },
    environment: {
      ...versions,
      platform: `${process.platform}-${process.arch}`,
      revision: revision.trim(),
    },
    followUp:
      result === "pass"
        ? "Freeze the retained stationary profile and proceed to Gate C; Gate D and the full harness remain unauthorized."
        : result === "rework"
          ? "Apply only a predeclared Gate B source, entity, or profile dial and invalidate every affected judged artifact before rerunning."
          : "Stop downstream construction; Gate C, Gate D, and the full harness remain unauthorized.",
    producerVersions: [
      { name: "gate-b-instance-producer", version: "1.0.0" },
      { name: "gate-b-scorer", version: "1.0.0" },
      { name: "gate-b-reporter", version: "1.0.0" },
    ],
    rawArtifacts,
    result,
  });
  const verdict = validateGateReport(completed);
  if (!verdict.accepted) {
    throw new Error(`Completed Gate B report is invalid: ${verdict.reason} at ${verdict.pointer}.`);
  }
  const reportBytes = await writeCanonicalJson(
    resolve("artifacts/gate-b/gate-report.json"),
    completed,
  );
  await writeCanonicalJson(resolve("artifacts/gate-b/milestone-report.json"), {
    authorization: {
      fullHarnessAuthorized: false,
      gateCAuthorized: result === "pass",
      gateDAuthorized: false,
      reason:
        result === "pass"
          ? "Gate B authorizes Gate C only."
          : "Gate B did not pass, so no downstream gate is authorized.",
    },
    decision: result,
    gateReport: {
      artifactType: "gate-report",
      byteLength: reportBytes.length,
      sha256: sha256Hex(reportBytes),
    },
    milestoneId: "milestone-3-gate-b-decipherment-headroom",
    retainedProfile: result === "pass" ? gateBProfileId : null,
    schemaVersion: 1,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv.at(-1);
  if (mode === "--predeclare") {
    await predeclare();
  } else if (mode === "--check") {
    await checkGateBPredeclaration();
  } else if (mode === "--complete") {
    await completeGateBReport();
  } else {
    throw new Error("Usage: tsx tools/gate-b/report.ts --predeclare|--check|--complete");
  }
}
