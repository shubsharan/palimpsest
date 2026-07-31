import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeBuildManifest, type DesignReceipt, type PhaseSummary } from "./artifacts.js";
import { loadResolvedStudy } from "./config.js";
import {
  assertBuildMatchesStudy,
  createConfiguredStudyAgents,
  runExperimentFromFlags,
  runStudyExperiment,
} from "./experiment.js";
import type { ModelAdapter } from "./model.js";
import { FakeCommandSandbox, TEST_SANDBOX_IDENTITY, testBuildManifest } from "./test-helpers.js";

const root = resolve(".");
const sourceRevision = "1".repeat(40);

function adapter(): ModelAdapter {
  return {
    openSession() {
      throw new Error("Orchestration tests never open provider sessions.");
    },
  };
}

function receipt(): DesignReceipt {
  return { sourceRevision } as DesignReceipt;
}

function stoppedPhase(): PhaseSummary {
  return { phase: "calibration", state: "blocked" } as PhaseSummary;
}

describe("study experiment orchestration", () => {
  it("constructs the frozen assignment and accepts only registered builds", async () => {
    const study = await loadResolvedStudy("experiments/config.yaml", root);
    const models: string[] = [];
    const agents = createConfiguredStudyAgents(study, {
      createAdapter(options) {
        models.push(options.model);
        return adapter();
      },
    });

    expect(models).toEqual(["gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-sol"]);
    expect(agents["agent-1"]!.model.profile).toBe("sol");
    expect(agents["agent-2"]!.model.profile).toBe("sol");
    expect(agents["agent-3"]!.model.profile).toBe("sol");
    const manifest = decodeBuildManifest(testBuildManifest());
    expect(() => assertBuildMatchesStudy(manifest, study)).not.toThrow();
    expect(() =>
      assertBuildMatchesStudy({ ...manifest, blockId: "not-a-study-block" }, study),
    ).toThrow(/five registered study blocks/);
  });

  it("checks the clean preflight before constructing any provider adapter", async () => {
    const study = await loadResolvedStudy("experiments/config.yaml", root);
    const events: string[] = [];
    let observedTeamChannel: string | undefined;
    const sandbox = new FakeCommandSandbox();

    const result = await runStudyExperiment({
      root,
      configPath: "experiments/config.yaml",
      studyRoot: "/tmp/palimpsest-experiment-order",
      phase: "calibration",
      dependencies: {
        loadStudy: async () => study,
        createSandbox: async () => sandbox,
        prepareDesign: async () => receipt(),
        readPreflight: async () => {
          events.push("preflight");
          return {
            schemaVersion: 1,
            testedCommit: sourceRevision,
            sourceClean: true,
            completedAt: "2026-07-29T12:00:00.000Z",
            sandbox: TEST_SANDBOX_IDENTITY,
          };
        },
        createAdapter: () => {
          events.push("adapter");
          return adapter();
        },
        run: async (request) => {
          events.push("run");
          observedTeamChannel = request.teamChannel;
        },
        evaluate: async () => {
          events.push("evaluate");
          return {} as never;
        },
        publishBehaviorEvidence: async () => {
          events.push("behavior");
        },
        executePhase: async (options) => {
          await options.dependencies.beforeLaunch({
            cell: {
              cellId: "calibration-001-calibration-theron-ware-CS",
              phase: "calibration",
              blockId: "calibration-theron-ware",
              condition: "CS",
              conditionOrderPosition: 1,
              phasePosition: 1,
              buildRoot: "/tmp/palimpsest/build",
              pairedBuildId: `paired-${"2".repeat(64)}`,
              buildId: `build-${"3".repeat(64)}`,
            },
            attemptId: "attempt-calibration-01-001",
            attemptRoot: "/tmp/palimpsest/attempt",
            studyRootId: "study-fixture",
            designDigest: "4".repeat(64),
            tokenBudgetPerAgent: 200_000,
            monetaryAuthorizationCeilingCents: 10_000,
          });
          await options.dependencies.runCell({
            cell: {
              cellId: "calibration-001-calibration-theron-ware-CS",
              phase: "calibration",
              blockId: "calibration-theron-ware",
              condition: "CS",
              conditionOrderPosition: 1,
              phasePosition: 1,
              buildRoot: "/tmp/palimpsest/build",
              pairedBuildId: `paired-${"2".repeat(64)}`,
              buildId: `build-${"3".repeat(64)}`,
            },
            attemptId: "attempt-calibration-01-001",
            attemptRoot: "/tmp/palimpsest/attempt",
            studyRootId: "study-fixture",
            designDigest: "4".repeat(64),
            tokenBudgetPerAgent: 200_000,
            monetaryAuthorizationCeilingCents: 10_000,
          });
          return stoppedPhase();
        },
      },
    });

    expect(events).toEqual([
      "preflight",
      "adapter",
      "adapter",
      "adapter",
      "run",
      "evaluate",
      "behavior",
    ]);
    expect(observedTeamChannel).toBe("enabled");
    expect(result.state).toBe("blocked");
  });

  it("fails preflight without constructing an adapter", async () => {
    const study = await loadResolvedStudy("experiments/config.yaml", root);
    let adapterCalls = 0;

    await expect(
      runStudyExperiment({
        root,
        configPath: "experiments/config.yaml",
        studyRoot: "/tmp/palimpsest-experiment-preflight",
        phase: "calibration",
        dependencies: {
          loadStudy: async () => study,
          createSandbox: async () => new FakeCommandSandbox(),
          prepareDesign: async () => receipt(),
          readPreflight: async () => {
            throw new Error("receipt is stale");
          },
          createAdapter: () => {
            adapterCalls += 1;
            return adapter();
          },
          executePhase: async (options) => {
            await options.dependencies.beforeLaunch({
              cell: {
                cellId: "calibration-001-calibration-theron-ware-CS",
                phase: "calibration",
                blockId: "calibration-theron-ware",
                condition: "CS",
                conditionOrderPosition: 1,
                phasePosition: 1,
                buildRoot: "/tmp/palimpsest/build",
                pairedBuildId: `paired-${"2".repeat(64)}`,
                buildId: `build-${"3".repeat(64)}`,
              },
              attemptId: "attempt-calibration-01-001",
              attemptRoot: "/tmp/palimpsest/attempt",
              studyRootId: "study-fixture",
              designDigest: "4".repeat(64),
              tokenBudgetPerAgent: 200_000,
              monetaryAuthorizationCeilingCents: 10_000,
            });
            return stoppedPhase();
          },
        },
      }),
    ).rejects.toThrow(/receipt is stale/);
    expect(adapterCalls).toBe(0);
  });

  it("accepts only the phase study-root and optional replacement flags", () => {
    expect(() =>
      runExperimentFromFlags(
        new Map([
          ["--config", "experiments/config.yaml"],
          ["--phase", "pilot"],
          ["--study-root", "artifacts/study"],
        ]),
      ),
    ).toThrow(/calibration or validation/);
    expect(() =>
      runExperimentFromFlags(
        new Map([
          ["--config", "experiments/config.yaml"],
          ["--phase", "calibration"],
          ["--study-root", "artifacts/study"],
          ["--condition", "CS"],
        ]),
      ),
    ).toThrow(/Unsupported experiment flag/);
  });
});
