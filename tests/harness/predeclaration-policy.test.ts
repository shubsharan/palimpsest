import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  buildPredeclaration,
  checkPredeclaration,
  writePredeclaration,
} from "../../tools/harness/report.js";

const fixturePaths = [
  ".tool-versions",
  "artifacts/harness/declared",
  "artifacts/harness/inputs/manifest.json",
  "containers/clean-solver/Dockerfile",
  "containers/fixture-agent/Dockerfile",
  "containers/git-gateway/Dockerfile",
  "containers/images.lock.json",
  "package.json",
  "packages/contracts/package.json",
  "packages/contracts/schemas",
  "packages/contracts/src",
  "packages/git-accounting/src",
  "packages/git-accounting/package.json",
  "packages/git-gateway/src",
  "packages/git-gateway/package.json",
  "packages/run-control/src",
  "packages/run-control/package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "python/pyproject.toml",
  "python/src/palimpsest/contracts",
  "python/src/palimpsest/grading",
  "python/src/palimpsest/replay",
  "python/src/palimpsest/solver",
  "python/uv.lock",
  "tools/harness/artifacts.ts",
  "tools/harness/build.ts",
  "tools/harness/config.ts",
  "tools/harness/container-runtime.ts",
  "tools/harness/fixture-worker.ts",
  "tools/harness/git-server-container.ts",
  "tools/harness/git-server.ts",
  "tools/harness/grade.ts",
  "tools/harness/inputs.ts",
  "tools/harness/offline.ts",
  "tools/harness/preflight.ts",
  "tools/harness/publication-slots.ts",
  "tools/harness/replay.ts",
  "tools/harness/report.ts",
  "tools/harness/run.ts",
] as const;

let root: string;
let baselineDigest: string;

async function mutate(path: string, replacement: (source: string) => string): Promise<void> {
  const absolute = join(root, path);
  const original = await readFile(absolute, "utf8");
  const changed = replacement(original);
  expect(changed).not.toBe(original);
  await writeFile(absolute, changed);
  try {
    const declaration = await buildPredeclaration(root);
    expect(declaration.declarationDigest).not.toBe(baselineDigest);
    await expect(checkPredeclaration(root)).rejects.toThrow(/does not match current inputs/);
  } finally {
    await writeFile(absolute, original);
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "palimpsest-predeclaration-policy-"));
  for (const path of fixturePaths) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(path, destination, { recursive: true });
  }
  const baseline = await buildPredeclaration(root);
  baselineDigest = String(baseline.declarationDigest);
  await writePredeclaration(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("offline harness execution-policy predeclaration", () => {
  test("binds the digest-pinned container image lock", async () => {
    await mutate("containers/images.lock.json", (source) =>
      source.replace(
        /"imageId": "sha256:([0-9a-f])/,
        (_match, first: string) => `"imageId": "sha256:${first === "0" ? "1" : "0"}`,
      ),
    );
  });

  test("binds the absolute schedule and runtime isolation policy", async () => {
    await mutate("tools/harness/run.ts", (source) =>
      source.replace("revealOffsetsMs: [0, 3_000]", "revealOffsetsMs: [0, 3_001]"),
    );
    await mutate("tools/harness/container-runtime.ts", (source) =>
      source.replace('"--internal", network', '"--internal=changed", network'),
    );
  });

  test("binds the accounting frame implementation and version", async () => {
    await mutate("packages/git-accounting/src/types.ts", (source) =>
      source.replace("ACCOUNTING_VERSION = 1", "ACCOUNTING_VERSION = 2"),
    );
  });

  test("binds the grader implementation and scoring policy", async () => {
    await mutate("python/src/palimpsest/grading/score_report.py", (source) =>
      source.replace("def ", "def  "),
    );

    const scoringPath = join(root, "artifacts/harness/declared/trusted/scoring.json");
    const scoring = await readFile(scoringPath, "utf8");
    await writeFile(scoringPath, scoring.replace("palimpsest-score-v1", "palimpsest-score-v2"));
    try {
      await expect(buildPredeclaration(root)).rejects.toThrow(/digest mismatch/);
      await expect(checkPredeclaration(root)).rejects.toThrow();
    } finally {
      await writeFile(scoringPath, scoring);
    }
  });

  test("binds every pinned tool version", async () => {
    await mutate(".tool-versions", (source) => source.replace("git 2.48.1", "git 2.48.2"));
  });

  test("binds artifact sealing, replay, reporting, and redaction semantics", async () => {
    await mutate("tools/harness/artifacts.ts", (source) =>
      source.replace("Attempt", "Bound attempt"),
    );
    await mutate("tools/harness/replay.ts", (source) =>
      source.replace("Replay artifacts", "Bound replay artifacts"),
    );
    await mutate("tools/harness/report.ts", (source) =>
      source.replace("Completion report", "Bound completion report"),
    );
    await mutate("python/src/palimpsest/replay/public_report.py", (source) =>
      source.replace("public", "bound_public"),
    );
  });

  test("binds cross-runtime contract schemas and validation semantics", async () => {
    await mutate("packages/contracts/schemas/offline-harness-report.schema.json", (source) =>
      source.replace(
        '"https://palimpsest.invalid/contracts/offline-harness-report/1"',
        '"https://palimpsest.invalid/contracts/offline-harness-report/1-bound"',
      ),
    );
    await mutate("packages/contracts/src/schema-registry.ts", (source) =>
      source.replace("contractIds", "boundContractIds"),
    );
    await mutate("python/src/palimpsest/contracts/schemas.py", (source) =>
      source.replace("SCHEMAS_ROOT", "BOUND_SCHEMAS_ROOT"),
    );
  });

  test("binds JavaScript and Python dependency locks and manifests", async () => {
    await mutate("pnpm-lock.yaml", (source) =>
      source.replace("lockfileVersion: '9.0'", "lockfileVersion: '9.1'"),
    );
    await mutate("python/uv.lock", (source) => source.replace("version = 1", "version = 2"));
    await mutate("package.json", (source) =>
      source.replace('"version": "0.0.0"', '"version": "0.0.1"'),
    );
    await mutate("python/pyproject.toml", (source) =>
      source.replace('version = "0.1.0"', 'version = "0.1.1"'),
    );
  });
});
