import { describe, expect, it } from "vitest";

import { buildAgentPrompt } from "./prompt.js";

describe("agent prompt", () => {
  const common = {
    agentId: "agent-2" as const,
    agentIds: ["agent-1", "agent-2", "agent-3", "agent-4"] as const,
    schedule: { releaseOffsetsMs: [0], cutoffMs: 90_000 },
    limits: { tokenLimitPerAgent: 20_000, spendCeilingCents: 0 },
  };

  it("supports variable team sizes and explicit communication capabilities", () => {
    const shared = buildAgentPrompt({
      ...common,
      capabilities: { git: "shared", teamRoom: "enabled" },
    });
    const isolated = buildAgentPrompt({
      ...common,
      capabilities: { git: "isolated", teamRoom: "disabled" },
    });

    expect(shared).toContain("one of 4 agents");
    expect(shared).toContain("post_team_message");
    expect(isolated).toContain("Peer communication is unavailable");
    expect(isolated).not.toContain("post_team_message");
  });

  it("discloses limits and the published solver boundary without prescribing workflow", () => {
    const prompt = buildAgentPrompt({
      ...common,
      capabilities: { git: "shared", teamRoom: "disabled" },
    });

    expect(prompt).toContain("ends after 90000 milliseconds");
    expect(prompt).toContain("model-token limit is 20000");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("does not assign roles, turns, checkpoints");
    expect(prompt).not.toMatch(/re-?key|stationary|anchor|sentinel|specialist/i);
  });

  it("represents an observation-only token policy", () => {
    const prompt = buildAgentPrompt({
      ...common,
      limits: { ...common.limits, tokenLimitPerAgent: null },
      capabilities: { git: "shared", teamRoom: "disabled" },
    });
    expect(prompt).toContain("no cumulative model-token cutoff");
    expect(prompt).toContain("usage is still recorded");
  });

  it("rejects a shared room in an isolated run", () => {
    expect(() =>
      buildAgentPrompt({
        ...common,
        capabilities: { git: "isolated", teamRoom: "enabled" },
      }),
    ).toThrow(/isolated run/i);
  });
});
