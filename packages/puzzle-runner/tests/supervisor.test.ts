import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_IDS, type AttemptConfig } from "../src/config.js";
import { FixtureAgentAdapter, type AgentAdapter } from "../src/adapters.js";
import { runAttempt } from "../src/supervisor.js";

async function fixtureConfig(root: string, wallTimeMs = 500): Promise<AttemptConfig> {
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

describe("session supervisor", () => {
  it("runs exactly three persistent sessions without a round barrier", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-supervisor-"));
    const config = await fixtureConfig(root);
    const adapter = new FixtureAgentAdapter({
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
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
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
    const seen: string[] = [];
    const adapter: AgentAdapter = {
      openSession(context) {
        return {
          async respond(request) {
            const prompt = request.prompt ?? "";
            const evidenceLine = prompt
              .split("\n")
              .find((line) => line.startsWith("Private evidence: "));
            if (!evidenceLine) throw new Error("Prompt omitted the private evidence path.");
            const evidencePath = evidenceLine.slice("Private evidence: ".length);
            expect(await readdir(evidencePath)).toEqual(["stage-01-stage-1.txt"]);
            seen.push(context.agentId);
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
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
    });
    expect(seen.sort()).toEqual([...AGENT_IDS]);
    expect(result.sessions.every((session) => session.state === "finished")).toBe(true);
  });

  it("ends only active sessions when global wall time expires", async () => {
    const root = await mkdtemp(join(tmpdir(), "palimpsest-wall-"));
    const config = await fixtureConfig(root, 80);
    const adapter = FixtureAgentAdapter.repeatingWait();
    const result = await runAttempt({
      config,
      adapter,
      checker: async () => ({ matchedWords: 0, totalWords: 0, coverage: 0, accuracy: 0 }),
    });
    expect(result.sessions.every((session) => session.state === "time-exhausted")).toBe(true);
  });
});
