import { access, readFile, readdir } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { canonicalJsonBytes } from "@palimpsest/contracts";

import { buildRuntimeVerdicts } from "../../tools/evidence/compare-runtimes.js";

const forbiddenPaths = [
  "agent",
  "apps",
  "infra",
  "packages/control-domain",
  "packages/git-meter",
  "packages/git-gateway",
  "python/src/palimpsest/replay",
];

describe("Milestone 1 boundaries", () => {
  async function schemaFiles(directory = "packages/contracts/schemas"): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const path = `${directory}/${entry.name}`;
        return entry.isDirectory() ? schemaFiles(path) : [path];
      }),
    );
    return files.flat().sort();
  }

  test("Milestone 1 schemas remain compatible and feasibility gates add only authorized schemas", async () => {
    const files = await schemaFiles();
    expect(files).toEqual([
      "packages/contracts/schemas/artifact-response-manifest.schema.json",
      "packages/contracts/schemas/budget-sweep-result.schema.json",
      "packages/contracts/schemas/canonical-archive.schema.json",
      "packages/contracts/schemas/canonical-json.schema.json",
      "packages/contracts/schemas/channel-fixture.schema.json",
      "packages/contracts/schemas/contract-envelope.schema.json",
      "packages/contracts/schemas/gate-b/gate-b-records.schema.json",
      "packages/contracts/schemas/gate-c-decision.schema.json",
      "packages/contracts/schemas/gate-report.schema.json",
      "packages/contracts/schemas/git-genesis.schema.json",
      "packages/contracts/schemas/logical-git-transaction.schema.json",
      "packages/contracts/schemas/relay-attempt-result.schema.json",
      "packages/contracts/schemas/reveal-event.schema.json",
      "packages/contracts/schemas/reveal-plan.schema.json",
      "packages/contracts/schemas/revision-instance.schema.json",
      "packages/contracts/schemas/revision-trajectory.schema.json",
      "packages/contracts/schemas/solver-checkpoint.schema.json",
      "packages/contracts/schemas/timing-capacity-result.schema.json",
      "packages/contracts/schemas/useful-state-checkpoint.schema.json",
    ]);
    const identifiers = await Promise.all(
      files.map(async (file) => {
        const schema = JSON.parse(await readFile(file, "utf8"));
        expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
        return schema.$id;
      }),
    );
    expect(new Set(identifiers).size).toBe(identifiers.length);
  });

  test("later-milestone and agent-facing package boundaries remain absent", async () => {
    for (const path of forbiddenPaths) {
      await expect(access(path)).rejects.toThrow();
    }
  });

  test("recorded fixture evidence exactly matches the current frozen corpus", async () => {
    const verdicts = await buildRuntimeVerdicts("typescript");
    const expected = canonicalJsonBytes({
      schemaVersion: 1,
      fixtureCount: verdicts.length,
      verdicts,
    });
    const recorded = await readFile("artifacts/milestone-1/contract-verdicts.json");
    expect(recorded).toEqual(expected);
  });

  test("every fixture file is declared exactly once", async () => {
    const manifest = JSON.parse(
      await readFile("packages/contracts/fixtures/manifest.json", "utf8"),
    );
    const declared = manifest.fixtures
      .map((fixture: { inputPath: string }) => fixture.inputPath)
      .sort();
    const fixtureFiles = (
      await Promise.all(
        ["valid", "invalid"].map(async (directory) =>
          (await readdir(`packages/contracts/fixtures/${directory}`)).map(
            (file) => `${directory}/${file}`,
          ),
        ),
      )
    )
      .flat()
      .sort();
    expect(declared).toEqual(fixtureFiles);
    expect(new Set(declared).size).toBe(declared.length);
  });

  test("all external schema references resolve to a registered schema identifier", async () => {
    const files = await schemaFiles();
    const schemas = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
    );
    const identifiers = new Set(schemas.map((schema) => schema.$id));
    const references = JSON.stringify(schemas).matchAll(/"\$ref":"([^"]+)"/g);
    for (const match of references) {
      const reference = match[1] ?? "";
      if (!reference.startsWith("#")) {
        expect(identifiers).toContain(reference.split("#")[0]);
      }
    }
  });

  test("promotion evidence proves deterministic success and failure isolation", async () => {
    const evidence = JSON.parse(
      await readFile("artifacts/milestone-1/promotion-evidence.json", "utf8"),
    );
    expect(evidence.honest.artifactDigest).toBe(evidence.honest.repeatedArtifactDigest);
    expect(evidence.failures).toHaveLength(9);
    expect(
      evidence.failures.every(
        (failure: { promotedArtifacts: number }) => failure.promotedArtifacts === 0,
      ),
    ).toBe(true);
    expect(evidence.networkProbe.networkAccess).toBe("denied");
    expect(evidence.retry.freshAttemptCount).toBe(2);
  });

  test("Gate C public artifacts omit source and revision oracle fields", async () => {
    const publicInstance = JSON.parse(
      await readFile("artifacts/gate-c/declared/public-instance.json", "utf8"),
    );
    expect(Object.keys(publicInstance).sort()).toEqual([
      "contractId",
      "instanceId",
      "profileId",
      "revealSlotCount",
      "schemaVersion",
      "tokenCount",
    ]);
    const publicRoot = "artifacts/gate-c/declared/public";
    const publicFiles = await readdir(`${publicRoot}/chapters`);
    expect(publicFiles.sort()).toEqual([
      "01.txt",
      "02.txt",
      "03.txt",
      "04.txt",
      "05.txt",
      "06.txt",
    ]);
    for (const file of publicFiles) {
      const content = await readFile(`${publicRoot}/chapters/${file}`, "utf8");
      expect(content).not.toContain("switchAfterChapter");
      expect(content).not.toContain("changedEntries");
    }
  });
});
