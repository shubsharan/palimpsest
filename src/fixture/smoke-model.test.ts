import { describe, expect, it } from "vitest";

import {
  createFixtureModelAdapter,
  decodeFixtureScenario,
  type FixtureScenario,
} from "./smoke-model.js";
import type { ModelSession, ModelTurn } from "../model/contracts.js";
import { TOOL_DEFINITIONS } from "../run/tools.js";

const SUPPORTED_SCENARIOS = {
  "collaborative-revision": true,
} as const satisfies Record<FixtureScenario, true>;

async function nextTurn(session: ModelSession, prompt?: string): Promise<ModelTurn> {
  return session.respond({
    ...(prompt === undefined ? {} : { prompt }),
    toolResults: [],
    signal: new AbortController().signal,
  });
}

describe("fixture scenario selection", () => {
  it("decodes every supported scenario and defaults omission to collaborative-revision", () => {
    for (const scenario of Object.keys(SUPPORTED_SCENARIOS) as FixtureScenario[]) {
      expect(decodeFixtureScenario(scenario)).toBe(scenario);
    }
    expect(decodeFixtureScenario()).toBe("collaborative-revision");
  });

  it.each(["", "collaborative", "revision", "unknown"])(
    "rejects the unsupported scenario %j",
    (scenario) => {
      expect(() => decodeFixtureScenario(scenario)).toThrow(
        /unknown fixture scenario.*collaborative-revision/i,
      );
      expect(() => createFixtureModelAdapter(scenario)).toThrow(
        /unknown fixture scenario.*collaborative-revision/i,
      );
    },
  );

  it("selects the deterministic collaborative-revision script for all three agents", async () => {
    const adapter = createFixtureModelAdapter("collaborative-revision");
    const defaultSession = await createFixtureModelAdapter().openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const agent1Session = await adapter.openSession({
      agentId: "agent-1",
      tools: TOOL_DEFINITIONS,
    });
    const agent2Session = await adapter.openSession({
      agentId: "agent-2",
      tools: TOOL_DEFINITIONS,
    });
    const agent3Session = await adapter.openSession({
      agentId: "agent-3",
      tools: TOOL_DEFINITIONS,
    });
    const agent1 = await nextTurn(agent1Session, "solve");
    const agent2Turns: ModelTurn[] = [];
    for (let index = 0; index < 7; index += 1) {
      agent2Turns.push(await nextTurn(agent2Session, index === 0 ? "solve" : undefined));
    }
    const agent3 = await nextTurn(agent3Session, "solve");
    const defaultAgent1 = await nextTurn(defaultSession, "solve");

    expect(defaultAgent1).toEqual(agent1);
    expect(agent1.toolCalls[0]).toMatchObject({
      name: "run_command",
      arguments: { command: expect.stringMatching(/git push origin HEAD:main/) },
    });
    expect(agent2Turns[0]?.toolCalls[0]).toMatchObject({
      name: "run_command",
      arguments: { command: expect.stringMatching(/mapping=v1/) },
    });
    expect(agent2Turns.slice(1, 6).map((turn) => turn.toolCalls[0]?.name)).toEqual(
      Array.from({ length: 5 }, () => "wait_for_activity"),
    );
    expect(agent2Turns[6]?.toolCalls[0]).toMatchObject({
      name: "run_command",
      arguments: { command: expect.stringMatching(/mapping=v2/) },
    });
    expect(agent3.toolCalls.map((call) => call.name)).toEqual(["check_published_solver"]);
  });

  it("uses only available tools when checker access is disabled", async () => {
    const session = await createFixtureModelAdapter().openSession({
      agentId: "agent-3",
      tools: TOOL_DEFINITIONS.filter(({ name }) => name !== "check_published_solver"),
    });

    const first = await nextTurn(session, "solve");
    const second = await session.respond({
      toolResults: [{ callId: "inspect-without-checker", output: { exitCode: 0 } }],
      signal: new AbortController().signal,
    });

    expect(first.toolCalls.map(({ name }) => name)).toEqual(["run_command"]);
    expect(first.toolCalls.map(({ name }) => name)).not.toContain("check_published_solver");
    expect(second.finalResponse).toContain("without checker feedback");
  });
});
