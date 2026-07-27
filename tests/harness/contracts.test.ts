import { readFile } from "node:fs/promises";

import { validateValue } from "@palimpsest/contracts";
import { describe, expect, test } from "vitest";

const cases = [
  ["instance-build-request", "instance-build-request"],
  ["run-manifest", "run-manifest"],
  ["score-report", "score-report"],
  ["offline-harness-report", "offline-harness-report"],
] as const;

describe("offline harness contract families", () => {
  for (const [contractId, filename] of cases) {
    test(`accepts ${contractId}`, async () => {
      const value = JSON.parse(
        await readFile(`packages/contracts/fixtures/valid/${filename}.json`, "utf8"),
      );
      expect(validateValue(contractId, value)).toMatchObject({
        accepted: true,
        reason: null,
        pointer: null,
      });
    });

    test(`rejects an unknown field in ${contractId}`, async () => {
      const value = JSON.parse(
        await readFile(
          `packages/contracts/fixtures/invalid/${filename}-unknown-field.json`,
          "utf8",
        ),
      );
      expect(validateValue(contractId, value)).toMatchObject({
        accepted: false,
        reason: "unknown_field",
      });
    });
  }

  test("requires zero provider calls for an authorized completion", async () => {
    const report = JSON.parse(
      await readFile("packages/contracts/fixtures/valid/offline-harness-report.json", "utf8"),
    );
    report.externalModelRequestCount = 1;
    expect(validateValue("offline-harness-report", report)).toMatchObject({
      accepted: false,
    });
    report.result = "invalid";
    report.liveModelValidationAuthorized = false;
    expect(validateValue("offline-harness-report", report)).toMatchObject({
      accepted: true,
    });
  });

  test("keeps the frozen predeclaration schema-valid", async () => {
    const predeclaration = JSON.parse(
      await readFile("artifacts/harness/predeclaration.json", "utf8"),
    );
    expect(predeclaration).not.toHaveProperty("declarationInputs");
    expect(validateValue("offline-harness-report", predeclaration)).toMatchObject({
      accepted: true,
    });
  });
});
