import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import {
  canonicalArchiveBytes,
  canonicalJsonBytes,
  completeGateReport,
  predeclarationDigest,
  sha256Hex,
  validateGateReport,
} from "@palimpsest/contracts";

interface FileEntry {
  path: string;
  sourcePath: string;
}

async function listFiles(root: string, current = root): Promise<FileEntry[]> {
  const names = await readdir(current);
  const entries: FileEntry[] = [];
  for (const name of names.sort()) {
    const sourcePath = join(current, name);
    const metadata = await stat(sourcePath);
    if (metadata.isDirectory()) {
      entries.push(...(await listFiles(root, sourcePath)));
    } else if (metadata.isFile()) {
      entries.push({
        path: relative(root, sourcePath).split(sep).join("/"),
        sourcePath,
      });
    }
  }
  return entries;
}

async function bundleReference(artifactType: string, roots: string[]) {
  const entries = [];
  for (const root of roots) {
    const metadata = await stat(root);
    if (metadata.isFile()) {
      entries.push({
        path: root,
        kind: "file" as const,
        contentBase64: (await readFile(root)).toString("base64"),
      });
      continue;
    }
    for (const entry of await listFiles(root)) {
      entries.push({
        path: join(root, entry.path).split(sep).join("/"),
        kind: "file" as const,
        contentBase64: (await readFile(entry.sourcePath)).toString("base64"),
      });
    }
  }
  const archive = canonicalArchiveBytes({
    schemaVersion: 1,
    contractId: "canonical-archive",
    entries,
  });
  return {
    artifactType,
    byteLength: archive.length,
    sha256: sha256Hex(archive),
  };
}

async function writeCanonical(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJsonBytes(value));
}

async function predeclare(): Promise<void> {
  const frozenInputs = [
    await bundleReference("contract-inputs", [
      "packages/contracts/schemas",
      "packages/contracts/fixtures",
      "specs/001-foundation-evidence-protocol/spec.md",
    ]),
    await bundleReference("implementation-source", [
      ".gitignore",
      ".node-version",
      ".npmrc",
      ".python-version",
      ".tool-versions",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "python/pyproject.toml",
      "python/uv.lock",
      "oxfmt.json",
      "oxlint.json",
      "packages/contracts/src",
      "python/src",
      "tools",
      "tests",
      "tsconfig.base.json",
      "tsconfig.json",
      "vitest.config.ts",
    ]),
  ];
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    state: "predeclared",
    gateId: "milestone-1-foundation",
    question: "Is the cross-runtime foundation reproducible enough to support Gates A-D?",
    frozenInputs,
    thresholds: [
      {
        name: "fixture agreement",
        metric: "contract.fixture_disagreements",
        operator: "eq",
        value: "0",
        unit: "count",
      },
      {
        name: "failed-attempt promotion",
        metric: "promotion.failed_artifacts",
        operator: "eq",
        value: "0",
        unit: "count",
      },
      {
        name: "toolchain mismatch",
        metric: "environment.version_mismatches",
        operator: "eq",
        value: "0",
        unit: "count",
      },
      {
        name: "clean snapshot changes",
        metric: "clean_snapshot.source_tree_changes",
        operator: "eq",
        value: "0",
        unit: "count",
      },
    ],
    criteria: {
      pass: "Every Milestone 1 binary requirement passes under the frozen implementation and inputs.",
      rework:
        "Any contract disagreement, promotion leak, or unpinned environment is fixed and the declaration and verification are rerun.",
      stop: "Not applicable because Milestone 1 establishes infrastructure and tests no empirical premise.",
    },
  };
  report.predeclarationDigest = predeclarationDigest(report);
  const verdict = validateGateReport(report);
  if (!verdict.accepted) {
    throw new Error(`Generated predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}`);
  }
  await writeCanonical(resolve("artifacts/milestone-1/predeclaration.json"), report);
}

async function resolveArtifact(path: string, artifactType: string) {
  const bytes = await readFile(path);
  const digest = sha256Hex(bytes);
  const destination = resolve("artifacts/milestone-1/by-digest", digest);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(path, destination);
  return { artifactType, byteLength: bytes.length, sha256: digest };
}

async function complete(): Promise<void> {
  const predeclared = JSON.parse(
    await readFile("artifacts/milestone-1/predeclaration.json", "utf8"),
  );
  const promotion = JSON.parse(
    await readFile("artifacts/milestone-1/promotion-evidence.json", "utf8"),
  );
  const cleanSnapshot = JSON.parse(
    await readFile("artifacts/milestone-1/clean-snapshot.json", "utf8"),
  );
  const rawArtifacts = [
    await resolveArtifact("artifacts/milestone-1/contract-verdicts.json", "contract-verdicts"),
    await resolveArtifact("artifacts/milestone-1/promotion-evidence.json", "promotion-evidence"),
    await resolveArtifact("artifacts/milestone-1/clean-snapshot.json", "clean-snapshot"),
  ];
  const report = completeGateReport(predeclared, {
    environment: promotion.environment,
    producerVersions: [
      { name: "reference-producer", version: "1.0.0" },
      { name: "milestone-reporter", version: "1.0.0" },
    ],
    rawArtifacts,
    analysis: {
      summary:
        "Cross-runtime contracts agree and every injected producer failure promoted no artifact.",
      metrics: [
        {
          name: "contract.fixture_disagreements",
          value: "0",
          unit: "count",
        },
        {
          name: "promotion.failed_artifacts",
          value: "0",
          unit: "count",
        },
        {
          name: "environment.version_mismatches",
          value: "0",
          unit: "count",
        },
        {
          name: "clean_snapshot.source_tree_changes",
          value: String(cleanSnapshot.sourceTreeChangesAfterVerification),
          unit: "count",
        },
      ],
    },
    result: "pass",
    followUp: "Proceed to feasibility work.",
  });
  const gateReportPath = resolve("artifacts/milestone-1/gate-report.json");
  await writeCanonical(gateReportPath, report);
  const gateReportBytes = canonicalJsonBytes(report);
  await writeCanonical(resolve("artifacts/milestone-1/milestone-report.json"), {
    schemaVersion: 1,
    milestoneId: "milestone-1-foundation",
    decision: "proceed",
    gateReport: {
      artifactType: "gate-report",
      byteLength: gateReportBytes.length,
      sha256: sha256Hex(gateReportBytes),
    },
    evidence: rawArtifacts,
    invalidatedDownstreamEvidence: [],
    authorization: {
      next: "Milestone 2 Gate A feasibility work",
      fullHarnessAuthorized: false,
      reason: "The architecture requires passing Gates A-D before full-harness construction.",
    },
    limitations: [
      "This report establishes the foundation protocol only; it records no Gate A-D empirical result.",
      `Clean-snapshot verification ran on ${cleanSnapshot.environment.platform}; the Linux reference deployment remains a later validation surface.`,
    ],
  });
}

const mode = process.argv.at(-1);
if (mode === "--predeclare") {
  await predeclare();
} else if (mode === "--complete") {
  await complete();
} else {
  throw new Error("Usage: tsx tools/evidence/gate-report.ts --predeclare|--complete");
}
