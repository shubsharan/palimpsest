import { describe, expect, it } from "vitest";

import { buildAgentPrompt } from "./prompt.js";

describe("agent prompt", () => {
  it("makes concurrent peers and Git communication explicit without revealing the transition", () => {
    const prompt = buildAgentPrompt({
      agentId: "agent-2",
    });

    expect(prompt).toContain("Agent 2");
    expect(prompt).toContain("three agents working concurrently");
    expect(prompt).toContain("Git repository");
    expect(prompt).toContain("Workspace: /workspace");
    expect(prompt).toContain("Private evidence: /evidence");
    expect(prompt).toContain("Reference corpus: /reference");
    expect(prompt).not.toContain("/private/agent-2");
    expect(prompt).toContain("Avoid committing raw ciphertext or reconstructed prose");
    expect(prompt).not.toMatch(/re-?key|substitution|changed mapping|transition stage/i);
    expect(prompt).not.toMatch(
      /assigned role|required (?:commit|branch|file|checkpoint)|take turns/i,
    );
  });
});
