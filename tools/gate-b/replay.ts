import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  canonicalArchiveBytes,
  canonicalJsonBytes,
  sha256Hex,
  validateGateReport,
  validateValue,
} from "@palimpsest/contracts";

import { checkGateBPredeclaration } from "./report.js";

const execFileAsync = promisify(execFile);

interface ArtifactReference {
  artifactType: string;
  byteLength: number;
  sha256: string;
}

async function resolveDigest(reference: ArtifactReference): Promise<Buffer> {
  const bytes = await readFile(`artifacts/gate-b/by-digest/${reference.sha256}`);
  if (bytes.length !== reference.byteLength || sha256Hex(bytes) !== reference.sha256) {
    throw new Error(`Digest store mismatch for ${reference.artifactType}/${reference.sha256}.`);
  }
  return bytes;
}

async function runPythonCheck(module: string): Promise<void> {
  await execFileAsync("uv", [
    "run",
    "--offline",
    "--frozen",
    "--project",
    "python",
    "python",
    "-m",
    module,
    "--check",
  ]);
}

export async function replayGateB() {
  await checkGateBPredeclaration();
  const report = JSON.parse(await readFile("artifacts/gate-b/gate-report.json", "utf8"));
  const predeclaration = JSON.parse(await readFile("artifacts/gate-b/predeclaration.json", "utf8"));
  const verdict = validateGateReport(report);
  if (!verdict.accepted || report.state !== "completed") {
    throw new Error(`Gate B report is invalid: ${verdict.reason} at ${verdict.pointer}.`);
  }
  if (report.predeclarationDigest !== predeclaration.predeclarationDigest) {
    throw new Error("Gate B report does not complete the current predeclaration.");
  }
  const resolved = new Map<string, Buffer>();
  for (const reference of report.rawArtifacts as ArtifactReference[]) {
    resolved.set(reference.artifactType, await resolveDigest(reference));
  }
  for (const artifactType of [
    "gate-b-instances",
    "gate-b-mechanical-attempts",
    "gate-b-identification-attempts",
    "gate-b-agent-attempts",
    "gate-b-human-attempts",
    "gate-b-entity-audits",
  ]) {
    const bytes = resolved.get(artifactType);
    if (!bytes) {
      throw new Error(`Gate B report omits ${artifactType}.`);
    }
    const archive = JSON.parse(bytes.toString("utf8"));
    const archiveVerdict = validateValue("canonical-archive", archive);
    if (
      !archiveVerdict.accepted ||
      !canonicalArchiveBytes(archive).equals(bytes) ||
      archive.entries.length === 0
    ) {
      throw new Error(`Gate B archive ${artifactType} is invalid or non-canonical.`);
    }
  }
  const scoreTable = JSON.parse(resolved.get("gate-b-score-table")!.toString("utf8"));
  const scoreVerdict = validateValue("gate-b-score-table", scoreTable);
  if (!scoreVerdict.accepted || scoreTable.rows.length !== 44) {
    throw new Error(
      `Gate B score table is incomplete: ${scoreVerdict.reason} at ${scoreVerdict.pointer}.`,
    );
  }
  const decision = JSON.parse(resolved.get("gate-b-decision-analysis")!.toString("utf8"));
  const decisionVerdict = validateValue("gate-b-decision-analysis", decision);
  if (
    !decisionVerdict.accepted ||
    decision.classification !== report.result ||
    decision.integrityFailures.length !== 0
  ) {
    throw new Error("Gate B report result does not follow its decision analysis.");
  }
  const analysis = JSON.parse(resolved.get("gate-b-analysis-summary")!.toString("utf8"));
  if (
    analysis.classification !== report.result ||
    analysis.decisionAnalysis.sha256 !== sha256Hex(canonicalJsonBytes(decision))
  ) {
    throw new Error("Gate B analysis summary does not bind the recorded decision.");
  }
  await runPythonCheck("palimpsest.gate_b.scoring_producer");
  await runPythonCheck("palimpsest.gate_b.analysis");
  const milestone = JSON.parse(await readFile("artifacts/gate-b/milestone-report.json", "utf8"));
  if (
    milestone.authorization.fullHarnessAuthorized !== false ||
    milestone.authorization.gateDAuthorized !== false ||
    milestone.authorization.gateCAuthorized !== (report.result === "pass")
  ) {
    throw new Error("Gate B milestone grants authority beyond the recorded decision.");
  }
  return {
    result: report.result,
    scoreRowCount: scoreTable.rows.length,
    rawArtifactCount: report.rawArtifacts.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await replayGateB();
  process.stdout.write(
    `Gate B replay passed: ${result.scoreRowCount} score rows, ${result.rawArtifactCount} raw artifacts, result ${result.result}.\n`,
  );
}
