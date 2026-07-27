import { describe, expect, test } from "vitest";

import { runComposedOfflineHarness } from "../../tools/harness/offline.js";

const declarationDigest = "a".repeat(64);

describe("composed offline harness", () => {
  test("runs build-to-report twice with zero provider calls and explicit retry isolation", async () => {
    const calls: string[] = [];
    const terminalReports = new Map<string, Record<string, unknown>>();
    let externalProviderCalls = 0;
    const stages = {
      async verifyInputs(root: string) {
        calls.push(`inputs:${root}`);
      },
      async buildBundle(root: string) {
        calls.push(`build:${root}`);
      },
      async writePredeclaration(root: string) {
        calls.push(`predeclare:${root}`);
      },
      async runAttempt({ runId }: { root: string; runId: string }) {
        calls.push(`run:${runId}`);
        return { declarationDigest, runId };
      },
      async grade(identity: { declarationDigest: string; runId: string }) {
        calls.push(`grade:${identity.runId}`);
      },
      async replay(identity: { declarationDigest: string; runId: string }) {
        calls.push(`replay:${identity.runId}`);
      },
      async complete(
        identity: { declarationDigest: string; runId: string },
        _root: string,
        options: {
          priorIdentity?: { declarationDigest: string; runId: string };
        } = {},
      ) {
        calls.push(`complete:${identity.runId}`);
        if (options.priorIdentity) {
          expect(options.priorIdentity).toEqual({
            declarationDigest,
            runId: "attempt-a",
          });
          expect(terminalReports.get("attempt-a")).toEqual({
            result: "rework",
            externalModelRequestCount: 0,
            liveModelValidationAuthorized: false,
          });
        }
        const report = {
          result: options.priorIdentity ? "pass" : "rework",
          externalModelRequestCount: externalProviderCalls,
          liveModelValidationAuthorized: options.priorIdentity !== undefined,
        };
        terminalReports.set(identity.runId, { ...report });
        return report;
      },
    };

    await expect(
      runComposedOfflineHarness("/fixture", {
        runIds: ["attempt-a", "attempt-b"],
        stages,
      }),
    ).resolves.toEqual({
      result: "pass",
      externalModelRequestCount: 0,
      liveModelValidationAuthorized: true,
    });
    expect(externalProviderCalls).toBe(0);
    expect(calls).toEqual([
      "inputs:/fixture",
      "build:/fixture",
      "predeclare:/fixture",
      "run:attempt-a",
      "grade:attempt-a",
      "replay:attempt-a",
      "complete:attempt-a",
      "run:attempt-b",
      "grade:attempt-b",
      "replay:attempt-b",
      "complete:attempt-b",
    ]);
  });

  test("rejects duplicate attempts and any provider request", async () => {
    await expect(
      runComposedOfflineHarness("/fixture", {
        runIds: ["same", "same"],
        stages: {
          async verifyInputs() {},
          async buildBundle() {},
          async writePredeclaration() {},
          async runAttempt({ runId }) {
            return { declarationDigest, runId };
          },
          async grade() {},
          async replay() {},
          async complete() {
            return {
              result: "rework",
              externalModelRequestCount: 0,
              liveModelValidationAuthorized: false,
            };
          },
        },
      }),
    ).rejects.toThrow("two distinct run IDs");

    await expect(
      runComposedOfflineHarness("/fixture", {
        runIds: ["attempt-a", "attempt-b"],
        stages: {
          async verifyInputs() {},
          async buildBundle() {},
          async writePredeclaration() {},
          async runAttempt({ runId }) {
            return { declarationDigest, runId };
          },
          async grade() {},
          async replay() {},
          async complete() {
            return {
              result: "invalid",
              externalModelRequestCount: 1,
              liveModelValidationAuthorized: false,
            };
          },
        },
      }),
    ).rejects.toThrow("external model request");
  });
});
