import { describe, expect, it } from "vitest";

import { buildAgentPrompt } from "./prompt.js";

describe("agent prompt", () => {
  const common = {
    agentId: "agent-2" as const,
    agentIds: ["agent-1", "agent-2", "agent-3", "agent-4"] as const,
    cutoffMs: 90_000,
    tokenBudgetPerAgent: 20_000,
  };

  it("supports variable team sizes and explicit communication capabilities", () => {
    const shared = buildAgentPrompt({ ...common, gitVisibility: "shared", teamRoom: "enabled" });
    const isolated = buildAgentPrompt({
      ...common,
      gitVisibility: "isolated",
      teamRoom: "disabled",
    });

    expect(shared).toContain("one of 4 agents");
    expect(shared).toContain("post_team_message");
    expect(isolated).toContain("Peer communication is unavailable");
    expect(isolated).not.toContain("post_team_message");
  });

  it("discloses limits and the published solver boundary without prescribing workflow", () => {
    const prompt = buildAgentPrompt({ ...common, gitVisibility: "shared", teamRoom: "disabled" });

    expect(prompt).toContain("ends after 90000 milliseconds");
    expect(prompt).toContain("model-token limit is 20000");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("does not assign roles, turns, checkpoints");
    expect(prompt).not.toMatch(/re-?key|stationary|anchor|sentinel|specialist/i);
  });

  it("represents an observation-only token policy", () => {
    const prompt = buildAgentPrompt({
      ...common,
      tokenBudgetPerAgent: null,
      gitVisibility: "shared",
      teamRoom: "disabled",
    });
    expect(prompt).toContain("no cumulative model-token cutoff");
    expect(prompt).toContain("usage is still recorded");
  });

  it("rejects a shared room in an isolated run", () => {
    expect(() =>
      buildAgentPrompt({ ...common, gitVisibility: "isolated", teamRoom: "enabled" }),
    ).toThrow(/isolated run/i);
  });
});
