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
    expect(shared).toContain("Team: agent-1, agent-2, agent-3, agent-4");
    expect(shared).toContain("post_team_message");
    expect(isolated).toContain("Peer communication is unavailable");
    expect(isolated).not.toContain("post_team_message");
  });

  it("discloses limits and the published solver boundary without prescribing workflow", () => {
    const prompt = buildAgentPrompt({
      ...common,
      capabilities: { git: "shared", teamRoom: "disabled" },
    });

    expect(prompt).toContain("Run cutoff: 90 seconds");
    expect(prompt).toContain("Model-token limit: 20000");
    expect(prompt).toContain("Only origin/main:solver.py is checked or graded");
    expect(prompt).toContain("no roles, turns, checkpoints");
    expect(prompt).not.toMatch(/re-?key|stationary|anchor|sentinel|specialist/i);
  });

  it("explains the puzzle, staged inputs, and complete-cipher grading boundary", () => {
    const prompt = buildAgentPrompt({
      ...common,
      schedule: { releaseOffsetsMs: [0, 5_000, 60_000], cutoffMs: 90_000 },
      capabilities: { git: "shared", teamRoom: "disabled" },
    });

    expect(prompt).toContain("hidden one-to-one substitutions");
    expect(prompt).toContain("Punctuation, capitalization patterns, digits");
    expect(prompt).not.toMatch(/reference material|\/reference/);
    expect(prompt).toContain("at start, 5 seconds, 1 minute");
    expect(prompt).toContain("final grading uses the complete ciphertext");
    expect(prompt).toContain("write only its complete plaintext");
  });

  it("represents an observation-only token policy", () => {
    const prompt = buildAgentPrompt({
      ...common,
      limits: { ...common.limits, tokenLimitPerAgent: null },
      capabilities: { git: "shared", teamRoom: "disabled" },
    });
    expect(prompt).toContain("no cumulative cutoff");
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
