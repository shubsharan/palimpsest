import { readFile, readdir } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const agents = ["agent-1", "agent-2", "agent-3"] as const;

describe("fixture-agent visibility isolation", () => {
  test("keeps private shards disjoint and public files free of sealed projections", async () => {
    const roots = await Promise.all(
      agents.map(async (agentId) => {
        const root = `artifacts/harness/declared/private/${agentId}`;
        const chapters = (await readdir(`${root}/chapters`)).sort();
        return { agentId, chapters };
      }),
    );
    expect(roots.map(({ chapters }) => chapters)).toEqual([
      ["010.txt", "011.txt"],
      ["012.txt", "013.txt"],
      ["014.txt", "015.txt"],
    ]);
    const publicManifest = await readFile(
      "artifacts/harness/declared/public/manifest.json",
      "utf8",
    );
    expect(publicManifest).not.toMatch(
      /stationary-key|revised-key|prepared\.txt|changed-entries|private\/agent/i,
    );
  });

  test("mounts only each agent's released input, workspace, and private output", async () => {
    const run = await readFile("tools/harness/run.ts", "utf8");
    expect(run).toContain("`${inputRoot}:/input:ro`");
    expect(run).toContain("`${invocation.workspacePath}:/workspace:rw`");
    expect(run).toContain("`${outputRoot}:/output:rw`");
    expect(run).not.toContain(":/sealed");
    expect(run).not.toContain(":/private/agent-");
    expect(run).not.toContain("OPENAI_API_KEY");
  });

  test("forwards no host credential or control environment to fixture workers", async () => {
    const bridge = await readFile("packages/run-control/src/model-bridge.ts", "utf8");
    expect(bridge).toContain("PATH: process.env.PATH");
    expect(bridge).toContain('LANG: "C.UTF-8"');
    expect(bridge).not.toMatch(/env:\s*\{\s*\.\.\.process\.env/);
    expect(bridge).not.toMatch(/OPENAI|ANTHROPIC|API_KEY|AWS_|GITHUB_TOKEN/);
  });
});
