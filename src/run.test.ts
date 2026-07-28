import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FixtureModelAdapter } from "./fixture.js";
import { AGENT_IDS, type ModelAdapter } from "./model.js";
import type { PreflightReceipt } from "./preflight.js";
import { systemMonotonicClock } from "./reveal.js";
import { runAttempt, validateAttemptConfig, type AttemptConfig } from "./run.js";
import { SandboxInfrastructureError } from "./sandbox/contracts.js";
import { FakeCommandSandbox } from "./test-helpers.js";

async function fixtureConfig(root: string, wallTimeMs = 2_000): Promise<AttemptConfig> {
  const makeStages = async (agentId: (typeof AGENT_IDS)[number]) => {
    await mkdir(join(root, "source", agentId), { recursive: true });
    return Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const path = join(root, "source", agentId, `stage-${index + 1}.txt`);
        await writeFile(path, `${agentId}-${index + 1}\n`, { encoding: "utf8", flag: "wx" });
        return path;
      }),
    );
  };
  const stages: AttemptConfig["agentStages"] = {
    "agent-1": await makeStages("agent-1"),
    "agent-2": await makeStages("agent-2"),
    "agent-3": await makeStages("agent-3"),
  };
  const reference = join(root, "reference");
  await writeFile(reference, "reference\n", "utf8");
  return {
    attemptId: "fixture",
    artifactRoot: join(root, "attempt"),
    buildPath: join(root, "build.json"),
    referenceCorpusPath: reference,
    agentStages: stages,
    tokenBudgetPerAgent: 20,
    wallTimeMs,
    stageIntervalMs: 10,
    shutdownToleranceMs: 100,
  };
}

describe("run coordinator", () => {
  it("copies preflight provenance before opening paid model sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-run-preflight-"));
    const config = await fixtureConfig(root);
    const preflight: PreflightReceipt = {
      schemaVersion: 1,
      testedCommit: "a".repeat(40),
      sourceClean: true,
      completedAt: "2026-07-28T12:00:00.000Z",
      sandbox: new FakeCommandSandbox().identity,
    };
    const adapter: ModelAdapter = {
      openSession() {
        return {
          async respond() {
            expect(
              JSON.parse(await readFile(join(config.artifactRoot, "preflight.json"), "utf8")),
            ).toEqual(preflight);
            return {
              toolCalls: [],
              finalResponse: "ready",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    };

    await runAttempt({
      config,
      adapter,
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
      preflight,
    });
  });

  it("accepts exactly three agents with six stages each and no interaction caps", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-config-"));
    const config = await fixtureConfig(root);

    expect(validateAttemptConfig(config)).toEqual(config);
    expect(config).not.toHaveProperty("maxTurns");
    expect(config).not.toHaveProperty("maxGitBytes");
  });

  it.each([
    ["tokenBudgetPerAgent", 0, "tokenBudgetPerAgent"],
    ["wallTimeMs", -1, "wallTimeMs"],
  ] as const)("rejects invalid %s", async (key, value, message) => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-config-invalid-"));
    const config = await fixtureConfig(root);
    expect(() => validateAttemptConfig({ ...config, [key]: value })).toThrow(message);
  });

  it("rejects invalid stage geometry", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-config-geometry-"));
    const config = await fixtureConfig(root);
    expect(() =>
      validateAttemptConfig({
        ...config,
        agentStages: {
          ...config.agentStages,
          "agent-3": config.agentStages["agent-3"].slice(0, 5),
        },
      }),
    ).toThrow("six stages");
  });

  it("runs exactly three persistent sessions without a round barrier", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-supervisor-"));
    const config = await fixtureConfig(root);
    const adapter = new FixtureModelAdapter({
      "agent-1": [
        { toolCalls: [], finalResponse: "done", usage: { inputTokens: 2, outputTokens: 1 } },
      ],
      "agent-2": [
        {
          toolCalls: [{ id: "wait-1", name: "wait_for_activity", arguments: { afterSequence: 0 } }],
          usage: { inputTokens: 2, outputTokens: 1 },
        },
        { toolCalls: [], finalResponse: "done later", usage: { inputTokens: 1, outputTokens: 1 } },
      ],
      "agent-3": [
        {
          toolCalls: [{ id: "cmd-1", name: "run_command", arguments: { command: "true" } }],
          usage: { inputTokens: 12, outputTokens: 9 },
        },
      ],
    });

    const result = await runAttempt({
      config,
      adapter,
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });

    expect(result.sessions).toHaveLength(3);
    expect(result.sessions.map((session) => session.state).sort()).toEqual([
      "finished",
      "finished",
      "token-exhausted",
    ]);
    expect(result.sessions.find((session) => session.agentId === "agent-1")?.finalResponse).toBe(
      "done",
    );
    expect(result.frozen.workspaces).toHaveLength(3);
  });

  it("publishes each agent's first private stage before opening its model session", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-initial-stage-"));
    const config = await fixtureConfig(root);
    const seen = new Map<string, string>();
    const adapter: ModelAdapter = {
      openSession(context) {
        return {
          async respond(request) {
            const prompt = request.prompt ?? "";
            const evidenceLine = prompt
              .split("\n")
              .find((line) => line.startsWith("Private evidence: "));
            if (!evidenceLine) throw new Error("Prompt omitted the private evidence path.");
            seen.set(context.agentId, evidenceLine.slice("Private evidence: ".length));
            return {
              toolCalls: [],
              finalResponse: "ready",
              usage: { inputTokens: 1, outputTokens: 1 },
            };
          },
        };
      },
    };
    const result = await runAttempt({
      config,
      adapter,
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });
    expect([...seen.keys()].sort()).toEqual([...AGENT_IDS]);
    for (const agentId of AGENT_IDS) {
      expect(seen.get(agentId)).toBe("/evidence");
      expect(await readdir(join(config.artifactRoot, "private-evidence", agentId))).toContain(
        "stage-01-stage-1.txt",
      );
    }
    expect(result.sessions.every((session) => session.state === "finished")).toBe(true);
  });

  it("ends only active sessions when global wall time expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-wall-"));
    const config = await fixtureConfig(root, 80);
    const adapter = FixtureModelAdapter.repeatingWait();
    const result = await runAttempt({
      config,
      adapter,
      sandbox: new FakeCommandSandbox(),
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });
    expect(result.sessions.every((session) => session.state === "time-exhausted")).toBe(true);
  });

  it("classifies command sandbox failures as session infrastructure errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-sandbox-failure-"));
    const config = await fixtureConfig(root);
    const adapter = new FixtureModelAdapter({
      "agent-1": [
        {
          toolCalls: [{ id: "command", name: "run_command", arguments: { command: "true" } }],
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ],
    });
    const sandbox = new FakeCommandSandbox(async () => {
      throw new SandboxInfrastructureError("Docker daemon unavailable.");
    });
    const result = await runAttempt({
      config,
      adapter,
      sandbox,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
      clock: systemMonotonicClock,
    });

    expect(result.sessions.find((session) => session.agentId === "agent-1")).toMatchObject({
      state: "infrastructure-error",
      terminationReason: "Docker daemon unavailable.",
    });
  });
});
