import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  completeGateReport,
  predeclarationDigest,
  sha256Hex,
  validateGateReport,
  validateValue,
} from "@palimpsest/contracts";

import {
  promoteBytes,
  referenceBundle,
  referenceFile,
  writeCanonicalJson,
} from "../gate-a/artifacts.js";
import { verifyVersionMap } from "../evidence/verify-versions.js";
import { FRONTIER_MODEL } from "./config.js";

const gateCRoot = "artifacts/gate-c";

async function frozenInputs() {
  return [
    await referenceFile(`${gateCRoot}/inputs/input-manifest.json`, "gate-c-input-manifest"),
    await referenceFile(`${gateCRoot}/inputs/solver-policy.json`, "gate-c-solver-policy"),
    await referenceFile(`${gateCRoot}/declared/private-instance.json`, "gate-c-revision-instance"),
    await referenceFile(`${gateCRoot}/declared/public-instance.json`, "gate-c-public-instance"),
    await referenceFile(`${gateCRoot}/declared/reveal-plan.json`, "gate-c-reveal-plan"),
    await referenceBundle("gate-c-declared-private-oracle", [
      `${gateCRoot}/declared/sealed/changed-entries.json`,
      `${gateCRoot}/declared/sealed/matched-controls.json`,
      `${gateCRoot}/declared/sealed/stationary-key.json`,
      `${gateCRoot}/declared/sealed/revised-key.json`,
    ]),
    await referenceBundle("gate-c-public-solver-packet", [
      `${gateCRoot}/declared/public-instance.json`,
      `${gateCRoot}/declared/public/chapters`,
    ]),
    await referenceBundle("gate-c-contracts", [
      "packages/contracts/schemas/revision-instance.schema.json",
      "packages/contracts/schemas/reveal-plan.schema.json",
      "packages/contracts/schemas/reveal-event.schema.json",
      "packages/contracts/schemas/solver-checkpoint.schema.json",
      "packages/contracts/schemas/revision-trajectory.schema.json",
      "packages/contracts/schemas/gate-c-decision.schema.json",
      "specs/004-revision-dynamics/contracts",
    ]),
    await referenceBundle("gate-c-implementation", [
      "python/src/palimpsest/gate_c",
      "python/tests/__init__.py",
      "python/tests/conftest.py",
      "python/tests/gate_c",
      "python/tests/helpers.py",
      "python/pyproject.toml",
      "tests/gate-c",
      "tools/gate-c",
      "package.json",
      "pnpm-lock.yaml",
      "python/uv.lock",
      "tsconfig.json",
      "vitest.config.ts",
    ]),
  ];
}

export function buildGateCPredeclaration(inputs: Awaited<ReturnType<typeof frozenInputs>>) {
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    state: "predeclared",
    gateId: "gate-c-revision-dynamics",
    question:
      "Does one hidden clock-driven partial re-key cause localized failure and selective recovery while stable mappings remain useful?",
    frozenInputs: inputs,
    thresholds: [
      {
        name: "pre-switch mapping gain",
        metric: "revision.pre-switch-gain-pp",
        operator: "gte",
        value: "10",
        unit: "percentage-points",
      },
      {
        name: "localized changed-entry drop",
        metric: "revision.localized-drop-pp",
        operator: "gte",
        value: "10",
        unit: "percentage-points",
      },
      {
        name: "changed-entry recovery",
        metric: "revision.changed-recovery-pp",
        operator: "gte",
        value: "10",
        unit: "percentage-points",
      },
      {
        name: "stable mapping retention",
        metric: "revision.stable-retention-pp",
        operator: "gte",
        value: "-5",
        unit: "percentage-points",
      },
      {
        name: "false retraction ceiling",
        metric: "revision.false-retraction-rate",
        operator: "lte",
        value: "0.10",
        unit: "fraction",
      },
      {
        name: "detection window",
        metric: "revision.detection-window-fraction",
        operator: "lte",
        value: "0.75",
        unit: "fraction",
      },
    ],
    criteria: {
      pass: "All declared revision predicates pass with no integrity failure.",
      rework: "Exactly one predeclared owning dial explains a visible but miscalibrated signal.",
      stop: "Revision is invisible, causes general collapse, or fails multiple predicates.",
    },
  };
  report.predeclarationDigest = predeclarationDigest(report);
  return report;
}

export async function predeclareGateC(): Promise<void> {
  const report = buildGateCPredeclaration(await frozenInputs());
  const verdict = validateGateReport(report);
  if (!verdict.accepted) {
    throw new Error(
      `Generated Gate C predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}.`,
    );
  }
  const destination = resolve(`${gateCRoot}/predeclaration.json`);
  const previous = await readFile(destination, "utf8")
    .then((source) => JSON.parse(source) as Record<string, unknown>)
    .catch(() => undefined);
  if (
    previous &&
    typeof previous.predeclarationDigest === "string" &&
    previous.predeclarationDigest !== report.predeclarationDigest
  ) {
    const invalidationPath = resolve(`${gateCRoot}/invalidated-predeclarations.json`);
    const invalidated = await readFile(invalidationPath, "utf8")
      .then((source) => JSON.parse(source) as { digests: string[] })
      .catch(() => ({ digests: [] }));
    await writeCanonicalJson(invalidationPath, {
      schemaVersion: 1,
      digests: [...new Set([...invalidated.digests, previous.predeclarationDigest])].sort(),
      reason: "A frozen Gate C input, implementation, policy, or threshold changed.",
    });
  }
  await writeCanonicalJson(destination, report);
}

export async function checkGateCPredeclaration(): Promise<Record<string, unknown>> {
  const recorded = JSON.parse(await readFile(`${gateCRoot}/predeclaration.json`, "utf8")) as Record<
    string,
    unknown
  >;
  const verdict = validateGateReport(recorded);
  if (!verdict.accepted) {
    throw new Error(
      `Recorded Gate C predeclaration is invalid: ${verdict.reason} at ${verdict.pointer}.`,
    );
  }
  const current = buildGateCPredeclaration(await frozenInputs());
  if (current.predeclarationDigest !== recorded.predeclarationDigest) {
    throw new Error("Gate C predeclaration drifted from its frozen inputs.");
  }
  return recorded;
}

function explicitIdentity(args: string[]): { declarationDigest: string; runId: string } {
  const digestIndex = args.indexOf("--declaration-digest");
  const runIndex = args.indexOf("--run-id");
  const declarationDigest = digestIndex >= 0 ? args[digestIndex + 1] : undefined;
  const runId = runIndex >= 0 ? args[runIndex + 1] : undefined;
  if (
    digestIndex < 0 ||
    runIndex < 0 ||
    !declarationDigest?.match(/^[0-9a-f]{64}$/) ||
    !runId?.match(/^[a-z0-9][a-z0-9-]{0,63}$/)
  ) {
    throw new Error("--declaration-digest and --run-id are required.");
  }
  return { declarationDigest, runId };
}

async function promoted(path: string, artifactType: string, root: string) {
  return promoteBytes(await readFile(path), artifactType, join(root, "by-digest"));
}

async function terminalOutputEntries(
  root: string,
  current = root,
): Promise<
  Array<{
    byteLength: number;
    path: string;
    sha256: string;
  }>
> {
  const entries: Array<{ byteLength: number; path: string; sha256: string }> = [];
  for (const name of (await readdir(current)).sort()) {
    if (name === "terminal.json") {
      continue;
    }
    const path = join(current, name);
    const metadata = await stat(path);
    if (metadata.isDirectory()) {
      entries.push(...(await terminalOutputEntries(root, path)));
    } else if (metadata.isFile()) {
      const bytes = await readFile(path);
      entries.push({
        path: relative(root, path).split(sep).join("/"),
        byteLength: bytes.length,
        sha256: sha256Hex(bytes),
      });
    }
  }
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

export async function verifyTerminalAttempt(
  attempt: string,
  attemptId: string,
): Promise<Record<string, unknown>> {
  const terminal = JSON.parse(await readFile(join(attempt, "terminal.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const actualOutputs = await terminalOutputEntries(attempt);
  const recordedOutputs = terminal.outputs;
  if (
    terminal.attemptId !== attemptId ||
    terminal.status !== "scored" ||
    terminal.model !== FRONTIER_MODEL ||
    !Array.isArray(recordedOutputs) ||
    recordedOutputs.length !== actualOutputs.length ||
    recordedOutputs.some((entry, index) => {
      const actual = actualOutputs[index];
      return (
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        actual === undefined ||
        (entry as Record<string, unknown>).path !== actual.path ||
        (entry as Record<string, unknown>).byteLength !== actual.byteLength ||
        (entry as Record<string, unknown>).sha256 !== actual.sha256
      );
    })
  ) {
    throw new Error("Gate C terminal manifest does not bind the exact scored attempt.");
  }
  return terminal;
}

export async function completeGateCFrom(options: {
  gateRoot: string;
  identity: { declarationDigest: string; runId: string };
  predeclared: Record<string, unknown>;
}): Promise<void> {
  const { gateRoot, identity, predeclared } = options;
  if (identity.declarationDigest !== predeclared.predeclarationDigest) {
    throw new Error("Explicit attempt does not belong to the current Gate C declaration.");
  }
  const attemptId = `gate-c/${identity.declarationDigest}/${identity.runId}`;
  const attempt = join(gateRoot, "attempts", identity.declarationDigest, identity.runId);
  const terminal = await verifyTerminalAttempt(attempt, attemptId);
  const trajectory = JSON.parse(await readFile(`${attempt}/trajectory.json`, "utf8"));
  const decision = JSON.parse(await readFile(`${attempt}/decision.json`, "utf8"));
  for (const [contractId, value] of [
    ["revision-trajectory", trajectory],
    ["gate-c-decision", decision],
  ] as const) {
    const verdict = validateValue(contractId, value);
    if (!verdict.accepted) {
      throw new Error(`${contractId} is invalid: ${verdict.reason} at ${verdict.pointer}.`);
    }
    if (value.attemptId !== attemptId) {
      throw new Error(`${contractId} does not belong to the explicit attempt.`);
    }
  }
  if (decision.classification === "invalid") {
    throw new Error("An invalid attempt cannot complete Gate C.");
  }
  if (terminal.classification !== decision.classification) {
    throw new Error("Gate C terminal classification does not match its decision.");
  }
  const replayArtifacts = [
    ["terminal.json", "gate-c-terminal-manifest"],
    ["replay-inputs.json", "gate-c-replay-inputs"],
    ["inputs/private-instance.json", "gate-c-revision-instance"],
    ["inputs/reveal-plan.json", "gate-c-reveal-plan"],
    ["inputs/changed-entries.json", "gate-c-changed-entry-set"],
    ["inputs/matched-controls.json", "gate-c-matched-stable-controls"],
    ["reveal-events.json", "gate-c-reveal-events"],
    ["checkpoints.json", "gate-c-solver-checkpoints"],
    ["solver-completion.json", "gate-c-solver-completion"],
    ["trajectory.json", "revision-trajectory"],
    ["decision.json", "gate-c-decision"],
  ] as const;
  const rawArtifacts = await Promise.all(
    replayArtifacts.map(([path, artifactType]) =>
      promoted(join(attempt, path), artifactType, gateRoot),
    ),
  );
  const environment = terminal.environment as Record<string, unknown>;
  verifyVersionMap({
    git: String(environment.git),
    node: String(environment.node),
    pnpm: String(environment.pnpm),
    python: String(environment.python),
    uv: String(environment.uv),
  });
  const result = decision.classification as "pass" | "rework" | "stop";
  const completed = completeGateReport(predeclared, {
    analysis: {
      metrics: [
        {
          name: "revision.pre-switch-gain-pp",
          unit: "percentage-points",
          value: String(trajectory.preSwitchGainPp),
        },
        {
          name: "revision.localized-drop-pp",
          unit: "percentage-points",
          value: String(trajectory.localizedDropPp),
        },
        {
          name: "revision.changed-recovery-pp",
          unit: "percentage-points",
          value: String(trajectory.changedRecoveryPp),
        },
      ],
      summary:
        "One explicit attempt was scored for localized deterioration, selective recovery, stable retention, false retractions, and clock-relative detection.",
    },
    environment,
    followUp:
      result === "pass"
        ? "Authorize only the minimum Gate D communication-value experiment."
        : result === "rework"
          ? `Change only the declared owning dial ${String(decision.owningDial)} and rerun Gate C.`
          : "Stop Gate D and full-harness construction.",
    producerVersions: [
      { name: "gate-c-runner", version: "1.0.0" },
      { name: "gate-c-scorer", version: "1.0.0" },
      { name: "gate-c-reporter", version: "1.0.0" },
    ],
    rawArtifacts,
    result,
  });
  const verdict = validateGateReport(completed);
  if (!verdict.accepted) {
    throw new Error(`Completed Gate C report is invalid: ${verdict.reason} at ${verdict.pointer}.`);
  }
  const reportBytes = await writeCanonicalJson(join(gateRoot, "gate-report.json"), completed);
  await writeCanonicalJson(join(gateRoot, "milestone-report.json"), {
    schemaVersion: 1,
    milestoneId: "milestone-4-gate-c-revision-dynamics",
    decision: result,
    attemptId,
    gateReport: {
      artifactType: "gate-report",
      byteLength: reportBytes.length,
      sha256: sha256Hex(reportBytes),
    },
    authorization: {
      gateDAuthorization: result === "pass" ? "minimal-only" : "none",
      fullHarnessAuthorized: false,
    },
  });
}

export async function completeGateC(args: string[]): Promise<void> {
  await completeGateCFrom({
    gateRoot: gateCRoot,
    identity: explicitIdentity(args),
    predeclared: await checkGateCPredeclaration(),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--predeclare")) {
    await predeclareGateC();
  } else if (process.argv.includes("--check")) {
    await checkGateCPredeclaration();
  } else if (process.argv.includes("--complete")) {
    await completeGateC(process.argv.slice(2));
  } else {
    throw new Error("Usage: tsx tools/gate-c/report.ts --predeclare|--check|--complete");
  }
}
