import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  createAttempt,
  sealFailedAttempt,
  verifyTerminalAttempt,
} from "../../tools/harness/artifacts.js";
import { HARNESS_ROOT } from "../../tools/harness/config.js";
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

  test("seals an attempt when an offline stage fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-offline-failure-"));
    const identity = { declarationDigest, runId: "attempt-failed" };
    const harnessRoot = join(root, HARNESS_ROOT);

    await expect(
      runComposedOfflineHarness(root, {
        runIds: ["attempt-failed", "unused-retry"],
        stages: {
          async verifyInputs() {},
          async buildBundle() {},
          async writePredeclaration() {},
          async runAttempt() {
            await createAttempt({
              root: harnessRoot,
              identity,
              startedAt: "2026-07-26T00:00:00.000Z",
            });
            return identity;
          },
          async grade() {
            throw new Error("deterministic grade failure");
          },
          async replay() {
            throw new Error("replay must not run");
          },
          async complete() {
            throw new Error("complete must not run");
          },
          async sealFailure(failedIdentity, _root, phase, error) {
            return sealFailedAttempt({
              root: harnessRoot,
              identity: failedIdentity,
              phase,
              error,
            });
          },
        },
      }),
    ).rejects.toThrow("deterministic grade failure");

    await expect(verifyTerminalAttempt({ root: harnessRoot, identity })).resolves.toMatchObject({
      classification: "failed",
    });
    expect(
      JSON.parse(
        await readFile(
          join(harnessRoot, "attempts", declarationDigest, identity.runId, "failure.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ phase: "grade", message: "deterministic grade failure" });
    expect(JSON.parse(await readFile(join(harnessRoot, "current.json"), "utf8"))).toMatchObject({
      runId: identity.runId,
      status: "failed",
    });
  });
});
