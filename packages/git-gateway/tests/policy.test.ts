import { describe, expect, test } from "vitest";

import { assertAuthorizedRef, assertSafeCapability } from "../src/policy.js";

describe("Git Gateway policy", () => {
  test("binds authenticated agents to their namespace", () => {
    const agent = {
      agentId: "agent-1",
      refNamespace: "refs/heads/agents/agent-1" as const,
    };
    expect(() => assertAuthorizedRef(agent, "refs/heads/agents/agent-1/work")).not.toThrow();
    expect(() => assertAuthorizedRef(agent, "refs/heads/agents/agent-2/work")).toThrow(
      /cannot update/,
    );
    expect(() => assertAuthorizedRef(agent, "refs/heads/main")).toThrow(/cannot update/);
  });

  test("allows only the frozen smart-protocol capability set", () => {
    expect(() => assertSafeCapability("object-format=sha256")).not.toThrow();
    expect(() => assertSafeCapability("delete-refs")).toThrow(/not permitted/);
  });
});
