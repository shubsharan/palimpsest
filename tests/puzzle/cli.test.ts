import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { contentDigest } from "../../src/canonical.js";
import { buildFixture, derivedFixtureDefinition } from "../../src/fixture/build.js";
import { loadResolvedExperiment } from "../../src/experiment/manifest.js";
import { parseFlags } from "../../src/flags.js";
import {
  appendRunAnalysis,
  loadRunRecord,
  type ProcessReviewRunAnalysis,
} from "../../src/run/record.js";
import { createCompletedRunFixture } from "../support/grading-fixture.js";

const root = resolve(".");
const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  async function makeWritable(path: string): Promise<void> {
    const metadata = await lstat(path).catch(() => undefined);
    if (metadata === undefined) return;
    if (metadata.isDirectory()) {
      await chmod(path, 0o755);
      await Promise.all((await readdir(path)).map((entry) => makeWritable(join(path, entry))));
    } else {
      await chmod(path, 0o644);
    }
  }
  await Promise.all(temporaryRoots.map(makeWritable));
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function execute(args: readonly string[]) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((finish) => {
    execFile(
      process.execPath,
      [tsxCli, "src/cli.ts", ...args],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          OPENAI_API_KEY: undefined,
          ANTHROPIC_API_KEY: undefined,
          GOOGLE_GENERATIVE_AI_API_KEY: undefined,
        },
      },
      (error, stdout, stderr) =>
        finish({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        }),
    );
  });
}

async function publishSyntheticCompletedReview(
  runRoot: string,
  projectRoot: string,
): Promise<void> {
  const loaded = await loadRunRecord(projectRoot, runRoot);
  const performance = loaded.record.analyses.find((analysis) => analysis.kind === "performance");
  if (performance === undefined) throw new Error("Synthetic CLI fixture is missing performance.");
  const analysisId = "process-review-cli-fixture";
  const scorecards = loaded.record.topology.origins.map(({ originId }) => ({
    schemaVersion: 1,
    runId: loaded.record.runId,
    canonicalOrigins: [{ originId, status: "eligible" }],
    outcome: { evaluations: [] },
    epistemic: {
      measures: [],
      reviewers: [
        { judge: 1, dimensions: [] },
        { judge: 2, dimensions: [] },
      ],
    },
    social: {
      measures: [],
      reviewers: [
        { judge: 1, dimensions: [] },
        { judge: 2, dimensions: [] },
      ],
    },
    instrumental: {
      measures: [],
      reviewers: [
        { judge: 1, dimensions: [] },
        { judge: 2, dimensions: [] },
      ],
    },
    disagreements: [],
    eligibility: { status: "completed" },
    limitations: ["Synthetic CLI routing fixture."],
  }));
  const scorecardBytes = `${JSON.stringify(scorecards, null, 2)}\n`;
  const manifest = {
    schemaVersion: 1,
    files: [
      {
        path: "scorecard.json",
        contentDigest: contentDigest(scorecards),
        byteCount: Buffer.byteLength(scorecardBytes),
        role: "run-scorecard",
      },
    ],
  };
  const detailRoot = join(runRoot, "grading", analysisId);
  await mkdir(detailRoot, { recursive: true });
  await Promise.all([
    writeFile(join(detailRoot, "scorecard.json"), scorecardBytes),
    writeFile(join(detailRoot, "manifest.json"), `${JSON.stringify(manifest)}\n`),
  ]);
  const review: ProcessReviewRunAnalysis = {
    analysisId,
    kind: "process-review",
    reviewedAt: "2026-08-03T00:00:00.000Z",
    status: "completed",
    performanceAnalysisId: performance.analysisId,
    rubricVersion: "epistemic-process-v1",
    configurationDigest: performance.configurationDigest,
    bundleDigest: performance.sourceDigest,
    detailsPath: `grading/${analysisId}/manifest.json`,
    detailsDigest: contentDigest(manifest),
    reviews: [
      { reviewId: "fake-openai", providerFamily: "openai", status: "completed" },
      { reviewId: "fake-anthropic", providerFamily: "anthropic", status: "completed" },
    ],
  };
  await appendRunAnalysis(runRoot, loaded.record, review);
}

async function writeDescriptiveReportConfig(path: string): Promise<void> {
  await writeFile(
    path,
    [
      "schemaVersion: 1",
      "claimType: descriptive",
      "include:",
      "  runIds: []",
      "  labels: {}",
      "versions:",
      "  grader: epistemic-process-v1",
      "  rubric: epistemic-process-v1",
      "experimentalUnit: team",
      "clusterBy: run",
      "",
    ].join("\n"),
  );
}

describe("operator CLI contract", () => {
  it("parses only explicit flag values", () => {
    expect(parseFlags(["--config", "experiments/config.yaml", "--run", "shared"])).toEqual(
      new Map([
        ["--config", "experiments/config.yaml"],
        ["--run", "shared"],
      ]),
    );
    expect(() => parseFlags(["--config"])).toThrow("--config requires a value.");
  });

  it("builds and decodes one package through the real Python boundary", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "palimpsest-fixture-build-"));
    temporaryRoots.push(temporaryRoot);
    const run = (await loadResolvedExperiment(join(root, "experiments/config.yaml"), root))
      .runs[0]!;
    const result = await buildFixture({
      root,
      output: join(temporaryRoot, "package"),
      fixture: derivedFixtureDefinition(run),
      selectedVariant: run.fixture.variant,
    });
    expect(result).toMatchObject({
      fixtureId: expect.stringMatching(/^fixture-[0-9a-f]{16}$/),
      contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      buildId: expect.stringMatching(/^build-[0-9a-f]{64}$/),
      rekeyAtStage: null,
    });
  }, 30_000);

  it("grades a completed synthetic run through the provider-free CLI", async () => {
    const temporaryRoot = await mkdtemp(join(root, ".git", "palimpsest-cli-grade-"));
    temporaryRoots.push(temporaryRoot);
    const fixture = await createCompletedRunFixture({
      root: temporaryRoot,
      configurationRoot: root,
    });

    const result = await execute(["grade", "--run-root", fixture.runRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      runRoot: fixture.runRoot,
      analysisId: expect.stringMatching(/^performance-/),
      kind: "performance",
      originCount: 1,
    });
  }, 30_000);

  it("rejects an explicitly requested review before adapter construction when credentials are absent", async () => {
    const temporaryRoot = await mkdtemp(join(root, ".git", "palimpsest-cli-review-"));
    temporaryRoots.push(temporaryRoot);
    const fixture = await createCompletedRunFixture({
      root: temporaryRoot,
      configurationRoot: root,
    });
    const graded = await execute(["grade", "--run-root", fixture.runRoot]);
    expect(graded.exitCode).toBe(0);
    const analysisId = (JSON.parse(graded.stdout) as { analysisId: string }).analysisId;

    const result = await execute([
      "review",
      "--run-root",
      fixture.runRoot,
      "--config",
      join(root, "grading", "epistemic-process-v1.yaml"),
      "--performance-analysis",
      analysisId,
      "--allow-spend",
      "true",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/(?:OPENAI_API_KEY|ANTHROPIC_API_KEY)/);
  }, 30_000);

  it("publishes a provider-free descriptive report through the CLI", async () => {
    const temporaryRoot = await mkdtemp(join(root, ".git", "palimpsest-cli-report-"));
    temporaryRoots.push(temporaryRoot);
    const fixture = await createCompletedRunFixture({
      root: temporaryRoot,
      configurationRoot: root,
    });
    const graded = await execute(["grade", "--run-root", fixture.runRoot]);
    expect(graded.exitCode).toBe(0);
    await publishSyntheticCompletedReview(fixture.runRoot, root);
    const configPath = join(temporaryRoot, "report.yaml");
    await writeDescriptiveReportConfig(configPath);
    const output = join(temporaryRoot, "report-output");

    const result = await execute([
      "report",
      "--artifacts-root",
      join(temporaryRoot, "artifacts"),
      "--config",
      configPath,
      "--output",
      output,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      reportId: expect.stringMatching(/^behavior-report-/),
      claimType: "descriptive",
      includedRunCount: 1,
      excludedRunCount: 0,
      path: join(output, "report.json"),
    });
    await expect(readFile(join(output, "report.json"), "utf8")).resolves.toContain(
      '"claimType": "descriptive"',
    );
  }, 30_000);

  it("rejects report output that overlaps a frozen run", async () => {
    const temporaryRoot = await mkdtemp(join(root, ".git", "palimpsest-cli-report-overlap-"));
    temporaryRoots.push(temporaryRoot);
    const fixture = await createCompletedRunFixture({
      root: temporaryRoot,
      configurationRoot: root,
    });
    const configPath = join(temporaryRoot, "report.yaml");
    await writeDescriptiveReportConfig(configPath);

    const result = await execute([
      "report",
      "--artifacts-root",
      join(temporaryRoot, "artifacts"),
      "--config",
      configPath,
      "--output",
      join(fixture.runRoot, "report-output"),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/must not overlap.*frozen run root/i);
  });

  it("rejects an unsupported matched claim without success JSON", async () => {
    const temporaryRoot = await mkdtemp(join(root, ".git", "palimpsest-cli-report-claim-"));
    temporaryRoots.push(temporaryRoot);
    const fixture = await createCompletedRunFixture({
      root: temporaryRoot,
      configurationRoot: root,
    });
    const configPath = join(temporaryRoot, "matched.yaml");
    await writeFile(
      configPath,
      [
        "schemaVersion: 1",
        "claimType: matched-contrast",
        "include:",
        "  runIds: []",
        "  labels: {}",
        "versions:",
        "  grader: epistemic-process-v1",
        "  rubric: epistemic-process-v1",
        "matchingFields:",
        "  - /configuration/run/fixture/constructionId",
        "treatmentField: /runId",
        "experimentalUnit: team",
        "clusterBy: run",
        "",
      ].join("\n"),
    );

    const result = await execute([
      "report",
      "--artifacts-root",
      join(temporaryRoot, "artifacts"),
      "--config",
      configPath,
      "--output",
      join(temporaryRoot, "report-output"),
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/genuine material run input/i);
    await expect(readFile(join(fixture.runRoot, "run.json"), "utf8")).resolves.toContain(
      fixture.record.runId,
    );
  });

  it.each([
    ["validate", []],
    ["experiment", []],
    ["evaluate", []],
    ["analyze", []],
    ["grade", []],
    ["review", []],
    ["report", []],
  ])("%s failures are stderr-only and nonzero", async (command, args) => {
    const result = await execute([command, ...args]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).not.toBe("");
  });
});
